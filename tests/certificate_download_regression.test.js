/**
 * tests/certificate_download_regression.test.js
 * Comprehensive regression & safety suite for Certificate View & PDF Download:
 * 1. Existing certificate MMC-2026-20072 (even when course.certificateEnabled is false)
 * 2. Valid legacy course certificate (name-only / missing optional completionDate)
 * 3. Valid examination certificate (ExamCertificate via cert number & verificationToken)
 * 4. Certificate with missing optional QR data & resilient QR failure fallback
 * 5. Invalid / nonexistent certificate number (no HTTP 500 or null .qrCode crash)
 * 6. Missing related course / student record (clear error instead of HTTP 500)
 * 7. Generated PDF validity & rendered certificate details verification
 * 8. QR verification URL resolution via GET /verify/:id
 */
const assert = require('assert');
const http = require('http');
const zlib = require('zlib');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

// Stub email delivery BEFORE loading certificate.controller via app
const emailService = require('../services/email.service');
emailService.sendOTPEmail = async (email, otp) => {
  console.log(`  [Cert Test Mock] OTP ${otp} for ${email}`);
  return { messageId: 'mock-cert-test' };
};

const connectDB = require('../config/db');
const app = require('../app');
const Course = require('../models/Course');
const CertificateStudent = require('../models/CertificateStudent');
const EmailOTP = require('../models/EmailOTP');
const Examination = require('../models/Examination');
const ExamAttempt = require('../models/ExamAttempt');
const ExamResult = require('../models/ExamResult');
const ExamCertificate = require('../models/ExamCertificate');

/**
 * Extract readable text fragments from compressed/uncompressed PDF streams.
 */
function extractPdfTextHints(pdfBuffer) {
  const raw = pdfBuffer.toString('latin1');
  let collected = raw;
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRegex.exec(raw)) !== null) {
    try {
      const inflated = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
      collected += '\n' + inflated;
    } catch (_) {
      // Not a zlib stream (or raw binary stream)
    }
  }
  return collected;
}

async function runCertificateRegressionTests() {
  const testTimeout = setTimeout(() => {
    console.error('❌ Certificate regression test suite timed out.');
    process.exit(1);
  }, 120000);
  testTimeout.unref();

  console.log('\n=============================================================');
  console.log('🧪 RUNNING CERTIFICATE DOWNLOAD & QR REGRESSION TEST SUITE');
  console.log('=============================================================\n');

  await connectDB();
  assert.strictEqual(
    mongoose.connection.name,
    'maths_mantras_test_isolated',
    'CRITICAL: Tests must run exclusively against maths_mantras_test_isolated'
  );

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanups = {
    courseIds: [],
    studentIds: [],
    examIds: [],
    attemptIds: [],
    resultIds: [],
    examCertIds: [],
    emails: [],
  };

  function makeRequest({ method = 'GET', path, headers = {}, body = null, cookies = [] }) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqHeaders = { ...headers };
      if (cookies.length > 0) {
        reqHeaders['Cookie'] = cookies.join('; ');
      }
      let payload = body;
      if (body && typeof body === 'object' && !(body instanceof Buffer)) {
        payload = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      } else if (typeof body === 'string') {
        reqHeaders['Content-Length'] = Buffer.byteLength(body);
      }

      const req = http.request(url, { method, headers: reqHeaders }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const setCookieHeaders = res.headers['set-cookie'] || [];
          const newCookies = [...cookies];
          setCookieHeaders.forEach((cookieStr) => {
            const pair = cookieStr.split(';')[0];
            const key = pair.split('=')[0];
            const existingIdx = newCookies.findIndex((c) => c.startsWith(`${key}=`));
            if (existingIdx !== -1) {
              newCookies[existingIdx] = pair;
            } else {
              newCookies.push(pair);
            }
          });
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            buffer: buf,
            body: buf.toString('utf8'),
            cookies: newCookies,
          });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function verifyOtpSessionForEmail(email) {
    cleanups.emails.push(email);
    await EmailOTP.deleteMany({ email });

    const sendRes = await makeRequest({
      method: 'POST',
      path: '/certificate/send-otp',
      body: { email },
    });
    assert.strictEqual(sendRes.statusCode, 200, `send-otp failed for ${email}: ${sendRes.body}`);

    const otpRecord = await EmailOTP.findOne({ email, verified: false }).sort({ createdAt: -1 });
    assert.ok(otpRecord, `OTP record must exist for ${email}`);

    const verifyRes = await makeRequest({
      method: 'POST',
      path: '/certificate/verify-otp',
      body: { email, otp: otpRecord.otp },
      cookies: sendRes.cookies,
    });
    assert.strictEqual(verifyRes.statusCode, 200, `verify-otp failed for ${email}: ${verifyRes.body}`);
    return verifyRes.cookies;
  }

  // Spy on ejs.renderFile to inspect exact HTML sent to Puppeteer for PDF generation
  const ejs = require('ejs');
  const origRenderFile = ejs.renderFile.bind(ejs);
  const renderedPdfHtmls = [];
  ejs.renderFile = async (filePath, data, opts) => {
    const html = await origRenderFile(filePath, data, opts);
    if (String(filePath).includes('certificate-pdf.ejs')) {
      renderedPdfHtmls.push({ filePath, data, html });
    }
    return html;
  };

  // Spy on QRCode.toString while preserving real output
  const capturedQrUrls = [];
  const origQrToString = QRCode.toString.bind(QRCode);
  let forceQrFailure = false;
  QRCode.toString = async (text, opts) => {
    if (forceQrFailure) {
      throw new Error('Simulated QR generation failure');
    }
    capturedQrUrls.push(text);
    return origQrToString(text, opts);
  };

  try {
    // ─── SETUP TEST FIXTURES IN ISOLATED DB ───────────────────────────────────
    const disabledCourse = await Course.create({
      title: 'MM-B03 Test Mirror',
      slug: `mm-b03-test-${Date.now()}`,
      passwordHash: 'dummy_hash',
      isActive: true,
      certificateEnabled: false,
      certificateCompletionDate: new Date('2026-11-25T00:00:00.000Z'),
    });
    cleanups.courseIds.push(disabledCourse._id);

    const enabledCourse = await Course.create({
      title: 'MM-B04 Active Course',
      slug: `mm-b04-test-${Date.now()}`,
      passwordHash: 'dummy_hash',
      isActive: true,
      certificateEnabled: true,
      certificateCompletionDate: null,
    });
    cleanups.courseIds.push(enabledCourse._id);

    // 1. Ensure MMC-2026-20072 fixture exists in isolated DB (reuse if seeded, else create & clean up)
    let cert20072 = await CertificateStudent.findOne({ certificateNumber: 'MMC-2026-20072' }).populate('courseId');
    let created20072 = false;
    if (!cert20072) {
      cert20072 = await CertificateStudent.create({
        fullName: 'najeeb',
        name: 'najeeb',
        email: 'flowerboks0@gmail.com',
        studentId: 'MM-2026-0069',
        certificateNumber: 'MMC-2026-20072',
        courseId: disabledCourse._id,
        issuedDate: new Date('2026-10-30T10:19:25.232Z'),
        isActive: true,
        verificationStatus: true,
      });
      created20072 = true;
      cleanups.studentIds.push(cert20072._id);
    } else if (cert20072.courseId) {
      // Ensure we know its email for OTP test
    }

    // 2. Legacy course certificate (name-only, no studentId, no completionDate)
    const legacyEmail = `legacy_cert_${Date.now()}@example.com`;
    const legacyCertNum = `MMC-2025-LEGACY-${Date.now()}`;
    const legacyStudent = await CertificateStudent.create({
      fullName: 'Legacy Course Graduate',
      name: 'Legacy Course Graduate',
      email: legacyEmail,
      certificateNumber: legacyCertNum,
      courseId: enabledCourse._id,
      totalMark: 95,
      marks: 95,
      issuedDate: new Date('2025-08-15T00:00:00.000Z'),
      isActive: true,
    });
    cleanups.studentIds.push(legacyStudent._id);

    // 3. Examination certificate (ExamCertificate)
    const examEmail = `exam_cert_${Date.now()}@example.com`;
    const examStudent = await CertificateStudent.create({
      fullName: 'Exam Achiever Student',
      email: examEmail,
      studentId: `ST-EX-${Date.now()}`,
      certificateNumber: `MMC-AUX-${Date.now()}`,
      courseId: enabledCourse._id,
      isActive: true,
    });
    cleanups.studentIds.push(examStudent._id);

    const testExam = await Examination.create({
      title: `Certification Exam ${Date.now()}`,
      category: 'Mathematics',
      durationMinutes: 60,
      status: 'published',
      courseId: enabledCourse._id,
      certificateEnabled: true,
    });
    cleanups.examIds.push(testExam._id);

    const testAttempt = await ExamAttempt.create({
      examinationId: testExam._id,
      studentId: examStudent._id,
      attemptNumber: 1,
      status: 'submitted',
      expiresAt: new Date(Date.now() + 600000),
      questionSnapshot: [],
    });
    cleanups.attemptIds.push(testAttempt._id);

    const testResult = await ExamResult.create({
      examinationId: testExam._id,
      studentId: examStudent._id,
      attemptId: testAttempt._id,
      attemptNumber: 1,
      totalAvailableMarks: 100,
      obtainedMarks: 92,
      percentage: 92,
      isPassed: true,
      resultStatus: 'published',
    });
    cleanups.resultIds.push(testResult._id);

    const examCertNum = `MM-EXAM-2026-${Date.now().toString().slice(-6)}`;
    const examVerifyToken = `EVRF-${Date.now().toString(16)}`;
    const examCert = await ExamCertificate.create({
      certificateNumber: examCertNum,
      verificationToken: examVerifyToken,
      studentId: examStudent._id,
      examinationId: testExam._id,
      attemptId: testAttempt._id,
      resultId: testResult._id,
      issueDate: new Date('2026-11-26T00:00:00.000Z'),
      status: 'valid',
    });
    cleanups.examCertIds.push(examCert._id);

    // 4. Dangling course reference (Missing related course record)
    const orphanCourseId = new mongoose.Types.ObjectId();
    const orphanCourseEmail = `orphan_course_${Date.now()}@example.com`;
    const orphanCourseCertNum = `MMC-2026-ORPHAN-${Date.now()}`;
    const orphanCourseStudent = await CertificateStudent.create({
      fullName: 'Orphan Course Student',
      email: orphanCourseEmail,
      certificateNumber: orphanCourseCertNum,
      courseId: orphanCourseId, // non-existent course
      isActive: true,
    });
    cleanups.studentIds.push(orphanCourseStudent._id);

    // 5. Dangling ExamCertificate student reference (Missing related student record)
    const orphanExamCertNum = `MM-EXAM-ORPHAN-${Date.now()}`;
    const orphanExamCert = await ExamCertificate.create({
      certificateNumber: orphanExamCertNum,
      verificationToken: `EVRF-ORPH-${Date.now().toString(16)}`,
      studentId: new mongoose.Types.ObjectId(), // deleted student
      examinationId: testExam._id,
      attemptId: new mongoose.Types.ObjectId(),
      resultId: new mongoose.Types.ObjectId(),
      status: 'valid',
    });
    cleanups.examCertIds.push(orphanExamCert._id);

    // ─── TEST 1: Existing Certificate MMC-2026-20072 (View & PDF Download) ─────
    console.log('--- TEST 1: Existing certificate MMC-2026-20072 (even when course certificateEnabled=false) ---');
    capturedQrUrls.length = 0;
    const view20072Res = await makeRequest({ path: '/certificate?cert=MMC-2026-20072' });
    assert.strictEqual(view20072Res.statusCode, 200, `GET /certificate?cert=MMC-2026-20072 must return 200 (got ${view20072Res.statusCode})`);
    assert.ok(!view20072Res.body.includes('Cannot set properties of null'), 'Must not contain null qrCode crash');
    assert.ok(view20072Res.body.includes('MMC-2026-20072'), 'Page must display certificate number MMC-2026-20072');
    assert.ok(view20072Res.body.includes(cert20072.fullName), 'Page must display student name');
    assert.ok(view20072Res.body.includes('<svg'), 'Page must include rendered QR SVG');

    const cookies20072 = await verifyOtpSessionForEmail(cert20072.email);
    const dl20072Res = await makeRequest({
      path: '/certificate/download/MMC-2026-20072',
      cookies: cookies20072,
    });
    assert.strictEqual(dl20072Res.statusCode, 200, `Download MMC-2026-20072 must return 200 (got ${dl20072Res.statusCode})`);
    assert.ok(
      (dl20072Res.headers['content-type'] || '').includes('application/pdf'),
      'Response Content-Type must be application/pdf'
    );
    assert.ok(dl20072Res.buffer.slice(0, 5).toString() === '%PDF-', 'Generated output must be a valid PDF binary');
    assert.ok(dl20072Res.buffer.length > 5000, 'Generated PDF must be non-empty');
    const pdf20072Render = renderedPdfHtmls.find((r) => r.data.certificateNumber === 'MMC-2026-20072');
    assert.ok(pdf20072Render, 'PDF template must render for MMC-2026-20072');
    assert.ok(pdf20072Render.html.includes(cert20072.fullName), 'Rendered PDF HTML must contain student name');
    assert.ok(pdf20072Render.html.includes('MMC-2026-20072'), 'Rendered PDF HTML must contain certificate number MMC-2026-20072');
    console.log(`  ✔ Test 1 Passed: MMC-2026-20072 viewed (200) and downloaded as PDF (${dl20072Res.buffer.length} bytes).`);

    // Confirm course with certificateEnabled=false still blocks NEW certificate requests
    const newReqRes = await makeRequest({
      method: 'POST',
      path: '/certificate',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        action: 'request',
        fullName: 'Blocked New Request',
        email: `blocked_new_${Date.now()}@example.com`,
        courseId: disabledCourse._id.toString(),
      }).toString(),
    });
    assert.ok(newReqRes.statusCode === 303 || newReqRes.statusCode === 302, 'Blocked request redirects cleanly');
    const createdBlocked = await CertificateStudent.findOne({ fullName: 'Blocked New Request' });
    assert.strictEqual(createdBlocked, null, 'New certificate request must still be blocked when certificateEnabled=false');
    console.log('  ✔ Verified: New certificate requests remain blocked for disabled courses.');

    // ─── TEST 2: Legacy Course Certificate Download & PDF Content ─────────────
    console.log('\n--- TEST 2 & 7: Valid legacy course certificate & PDF content ---');
    const legacyCookies = await verifyOtpSessionForEmail(legacyEmail);
    const legacyDlRes = await makeRequest({
      path: `/certificate/download/${encodeURIComponent(legacyCertNum)}`,
      cookies: legacyCookies,
    });
    assert.strictEqual(legacyDlRes.statusCode, 200, `Legacy certificate download must return 200 (got ${legacyDlRes.statusCode})`);
    assert.strictEqual(legacyDlRes.buffer.slice(0, 5).toString(), '%PDF-', 'Legacy certificate must produce valid PDF');
    const legacyPdfRender = renderedPdfHtmls.find((r) => r.data.certificateNumber === legacyCertNum);
    assert.ok(legacyPdfRender, 'PDF template must render for legacy certificate');
    assert.ok(legacyPdfRender.html.includes('Legacy Course Graduate'), 'Legacy PDF HTML must contain student name');
    assert.ok(legacyPdfRender.html.includes(legacyCertNum), 'Legacy PDF HTML must contain certificate number');
    console.log(`  ✔ Test 2 & 7 Passed: Legacy certificate PDF generated cleanly (${legacyDlRes.buffer.length} bytes) with student details.`);

    // ─── TEST 3: Valid Examination Certificate View & Download ────────────────
    console.log('\n--- TEST 3: Valid examination certificate (view, search, download) ---');
    const examSearchRes = await makeRequest({
      method: 'POST',
      path: '/certificate',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'search', query: examCertNum }).toString(),
    });
    assert.strictEqual(examSearchRes.statusCode, 303);
    assert.ok((examSearchRes.headers['location'] || '').includes(examCertNum), 'Search must redirect to exam certificate view');

    const examViewRes = await makeRequest({ path: `/certificate?cert=${encodeURIComponent(examCertNum)}` });
    assert.strictEqual(examViewRes.statusCode, 200);
    assert.ok(examViewRes.body.includes('Exam Achiever Student'), 'Exam certificate view must show student name');
    assert.ok(examViewRes.body.includes(examCertNum), 'Exam certificate view must show exam certificate number');

    const examCookies = await verifyOtpSessionForEmail(examEmail);
    const examDlRes = await makeRequest({
      path: `/certificate/download/${encodeURIComponent(examCertNum)}`,
      cookies: examCookies,
    });
    assert.strictEqual(examDlRes.statusCode, 200, `Exam certificate download must return 200 (got ${examDlRes.statusCode})`);
    assert.strictEqual(examDlRes.buffer.slice(0, 5).toString(), '%PDF-', 'Exam certificate must produce valid PDF');
    const examPdfRender = renderedPdfHtmls.find((r) => r.data.certificateNumber === examCertNum);
    assert.ok(examPdfRender, 'PDF template must render for exam certificate');
    assert.ok(examPdfRender.html.includes('Exam Achiever Student'), 'Exam PDF HTML must contain student name');
    assert.ok(examPdfRender.html.includes(examCertNum), 'Exam PDF HTML must contain exam certificate number');
    console.log(`  ✔ Test 3 Passed: ExamCertificate viewed and downloaded as PDF (${examDlRes.buffer.length} bytes).`);

    // ─── TEST 4: Missing Optional QR Data / Resilient QR Fallback ─────────────
    console.log('\n--- TEST 4: Missing optional QR data & QR failure resilience ---');
    const prevAppUrl = process.env.APP_URL;
    delete process.env.APP_URL;
    forceQrFailure = true;
    try {
      const noQrViewRes = await makeRequest({ path: `/certificate?cert=${encodeURIComponent(legacyCertNum)}` });
      assert.strictEqual(noQrViewRes.statusCode, 200, 'View must still return 200 if QR generation fails');
      assert.ok(noQrViewRes.body.includes('Legacy Course Graduate'), 'Student details still render cleanly');

      const noQrDlRes = await makeRequest({
        path: `/certificate/download/${encodeURIComponent(legacyCertNum)}`,
        cookies: legacyCookies,
      });
      assert.strictEqual(noQrDlRes.statusCode, 200, 'PDF download must still succeed if optional QR generation fails');
      assert.strictEqual(noQrDlRes.buffer.slice(0, 5).toString(), '%PDF-');
    } finally {
      forceQrFailure = false;
      if (prevAppUrl !== undefined) process.env.APP_URL = prevAppUrl;
    }
    console.log('  ✔ Test 4 Passed: Missing/failing optional QR data handled gracefully without HTTP 500.');

    // ─── TEST 5: Invalid Certificate Number ───────────────────────────────────
    console.log('\n--- TEST 5: Invalid certificate number ---');
    const invalidViewRes = await makeRequest({ path: '/certificate?cert=INVALID-CERT-999999' });
    assert.strictEqual(invalidViewRes.statusCode, 200, 'Invalid cert view must render clean portal message, not 500');
    assert.ok(!invalidViewRes.body.includes('Cannot set properties of null'));
    assert.ok(invalidViewRes.body.includes('No active certificate found'), 'Invalid cert view displays clear error message');

    const invalidDlRes = await makeRequest({
      path: '/certificate/download/INVALID-CERT-999999',
      cookies: legacyCookies,
    });
    assert.strictEqual(invalidDlRes.statusCode, 404, 'Invalid cert download must return 404, not 500');
    console.log('  ✔ Test 5 Passed: Invalid certificate number handled cleanly with clear error / 404.');

    // ─── TEST 6: Missing Related Student / Course Record ──────────────────────
    console.log('\n--- TEST 6: Missing related student/course record ---');
    const orphanCourseViewRes = await makeRequest({ path: `/certificate?cert=${encodeURIComponent(orphanCourseCertNum)}` });
    assert.strictEqual(orphanCourseViewRes.statusCode, 200, 'Missing course view must not return 500');
    assert.ok(
      orphanCourseViewRes.body.includes('course record associated with this certificate could not be found'),
      'Displays clear missing-course error message'
    );

    const orphanCourseCookies = await verifyOtpSessionForEmail(orphanCourseEmail);
    const orphanCourseDlRes = await makeRequest({
      path: `/certificate/download/${encodeURIComponent(orphanCourseCertNum)}`,
      cookies: orphanCourseCookies,
    });
    assert.strictEqual(orphanCourseDlRes.statusCode, 404, 'Missing course download must return 404, not 500');

    const orphanExamViewRes = await makeRequest({ path: `/certificate?cert=${encodeURIComponent(orphanExamCertNum)}` });
    assert.strictEqual(orphanExamViewRes.statusCode, 200, 'Missing exam student view must not return 500');
    assert.ok(
      orphanExamViewRes.body.includes('student record associated with this examination certificate could not be found'),
      'Displays clear missing-student error message'
    );

    const orphanExamDlRes = await makeRequest({
      path: `/certificate/download/${encodeURIComponent(orphanExamCertNum)}`,
      cookies: examCookies,
    });
    assert.strictEqual(orphanExamDlRes.statusCode, 404, 'Missing exam student download must return 404, not 500');
    console.log('  ✔ Test 6 Passed: Missing related course/student records render clear errors instead of HTTP 500.');

    // ─── TEST 8: QR Code Opens Correct Certificate Verification Page ──────────
    console.log('\n--- TEST 8: Verify QR code URLs open valid verification pages ---');
    const qrCourseUrl = capturedQrUrls.find((u) => u.includes('/verify/MMC-2026-20072'));
    assert.ok(qrCourseUrl, 'QR code for MMC-2026-20072 must encode /verify/MMC-2026-20072');
    const courseVerifyPath = new URL(qrCourseUrl).pathname;
    const verifyCourseRes = await makeRequest({ path: courseVerifyPath });
    assert.strictEqual(verifyCourseRes.statusCode, 200, `QR verification URL ${courseVerifyPath} must return 200`);
    assert.ok(verifyCourseRes.body.includes(cert20072.fullName), 'Verification page must show student name');
    assert.ok(
      verifyCourseRes.body.includes('MMC-2026-20072') ||
      (cert20072.studentId && verifyCourseRes.body.includes(cert20072.studentId)),
      'Verification page must show certificate or student identifier'
    );

    const qrLegacyUrl = capturedQrUrls.find((u) => u.includes(`/verify/${encodeURIComponent(legacyCertNum)}`));
    assert.ok(qrLegacyUrl, 'QR code for certified legacy course must encode verification URL');
    const legacyVerifyPath = new URL(qrLegacyUrl).pathname;
    const verifyLegacyRes = await makeRequest({ path: legacyVerifyPath });
    assert.strictEqual(verifyLegacyRes.statusCode, 200, `Legacy QR verification URL ${legacyVerifyPath} must return 200`);
    assert.ok(verifyLegacyRes.body.includes('Legacy Course Graduate'), 'Legacy verification page must show student name');
    assert.ok(verifyLegacyRes.body.includes(legacyCertNum), 'Legacy verification page must show certificate number');

    const qrExamUrl = capturedQrUrls.find((u) => u.includes(`/verify/${encodeURIComponent(examVerifyToken)}`));
    assert.ok(qrExamUrl, 'QR code for ExamCertificate must encode verificationToken URL');
    const examVerifyPath = new URL(qrExamUrl).pathname;
    const verifyExamRes = await makeRequest({ path: examVerifyPath });
    assert.strictEqual(verifyExamRes.statusCode, 200, `Exam QR verification URL ${examVerifyPath} must return 200`);
    assert.ok(verifyExamRes.body.includes('Exam Achiever Student'), 'Exam verification page must show student name');
    assert.ok(verifyExamRes.body.includes(examCertNum), 'Exam verification page must show exam certificate number');
    console.log('  ✔ Test 8 Passed: QR verification URLs open HTTP 200 pages with exact student & certificate details.');

    // ─── TEST 9: Authorization & ExamCertificate Status Enforcement ───────────
    console.log('\n--- TEST 9: ExamCertificate status enforcement & OTP email mismatch ---');

    // 9a. Email mismatch cannot download valid exam or course certificate
    const otherEmail = `other_student_${Date.now()}@example.com`;
    const otherCookies = await verifyOtpSessionForEmail(otherEmail);
    const mismatchExamDl = await makeRequest({
      path: `/certificate/download/${encodeURIComponent(examCertNum)}`,
      cookies: otherCookies,
    });
    assert.strictEqual(mismatchExamDl.statusCode, 303, 'Email mismatch on exam certificate must redirect (not download)');
    assert.strictEqual(mismatchExamDl.headers['location'], '/certificate');
    assert.ok(!(mismatchExamDl.headers['content-type'] || '').includes('application/pdf'));

    const mismatchCourseDl = await makeRequest({
      path: '/certificate/download/MMC-2026-20072',
      cookies: otherCookies,
    });
    assert.strictEqual(mismatchCourseDl.statusCode, 303, 'Email mismatch on course certificate must redirect (not download)');
    assert.strictEqual(mismatchCourseDl.headers['location'], '/certificate');
    console.log('  ✔ 9a Passed: Email mismatch blocked on both exam and course certificates.');

    // 9b. Revoked ExamCertificate cannot be viewed or downloaded
    const revokedCertNum = `MM-EXAM-REV-${Date.now().toString().slice(-6)}`;
    const revokedExamCert = await ExamCertificate.create({
      certificateNumber: revokedCertNum,
      verificationToken: `EVRF-REV-${Date.now().toString(16)}`,
      studentId: examStudent._id,
      examinationId: testExam._id,
      attemptId: new mongoose.Types.ObjectId(),
      resultId: new mongoose.Types.ObjectId(),
      status: 'revoked',
      revocationReason: 'Administrative test revocation',
    });
    cleanups.examCertIds.push(revokedExamCert._id);

    const revokedViewRes = await makeRequest({ path: `/certificate?cert=${encodeURIComponent(revokedCertNum)}` });
    assert.strictEqual(revokedViewRes.statusCode, 200);
    assert.ok(revokedViewRes.body.includes('officially revoked'), 'Revoked exam certificate must show revoked notice');
    assert.ok(!revokedViewRes.body.includes('/certificate/download/'), 'Revoked certificate must not render download link');

    const revokedDlRes = await makeRequest({
      path: `/certificate/download/${encodeURIComponent(revokedCertNum)}`,
      cookies: examCookies,
    });
    assert.strictEqual(revokedDlRes.statusCode, 403, 'Revoked exam certificate download must return 403');
    assert.ok(revokedDlRes.body.includes('revoked'));
    console.log('  ✔ 9b Passed: Revoked ExamCertificate cannot download (403).');

    // 9c. Other non-valid status (e.g., "pending") cannot be viewed or downloaded
    const pendingCertNum = `MM-EXAM-PEND-${Date.now().toString().slice(-6)}`;
    const pendingExamCert = await ExamCertificate.create({
      certificateNumber: pendingCertNum,
      verificationToken: `EVRF-PEND-${Date.now().toString(16)}`,
      studentId: examStudent._id,
      examinationId: testExam._id,
      attemptId: new mongoose.Types.ObjectId(),
      resultId: new mongoose.Types.ObjectId(),
      status: 'valid',
    });
    cleanups.examCertIds.push(pendingExamCert._id);
    await ExamCertificate.collection.updateOne(
      { _id: pendingExamCert._id },
      { $set: { status: 'pending' } }
    );

    const pendingViewRes = await makeRequest({ path: `/certificate?cert=${encodeURIComponent(pendingCertNum)}` });
    assert.strictEqual(pendingViewRes.statusCode, 200);
    assert.ok(pendingViewRes.body.includes('currently unavailable'), 'Non-valid exam status must show unavailable notice');
    assert.ok(!pendingViewRes.body.includes(`/certificate/download/${encodeURIComponent(pendingCertNum)}`));

    const pendingDlRes = await makeRequest({
      path: `/certificate/download/${encodeURIComponent(pendingCertNum)}`,
      cookies: examCookies,
    });
    assert.strictEqual(pendingDlRes.statusCode, 403, 'Non-valid status ("pending") must be blocked from download');
    assert.ok(!(pendingDlRes.headers['content-type'] || '').includes('application/pdf'));
    console.log('  ✔ 9c Passed: Non-valid ExamCertificate status ("pending") blocked from download (403).');

    // 9d. Missing / null status cannot be treated as valid
    const missingStatusCertNum = `MM-EXAM-MISS-${Date.now().toString().slice(-6)}`;
    const missingStatusCert = await ExamCertificate.create({
      certificateNumber: missingStatusCertNum,
      verificationToken: `EVRF-MISS-${Date.now().toString(16)}`,
      studentId: examStudent._id,
      examinationId: testExam._id,
      attemptId: new mongoose.Types.ObjectId(),
      resultId: new mongoose.Types.ObjectId(),
      status: 'valid',
    });
    cleanups.examCertIds.push(missingStatusCert._id);
    await ExamCertificate.collection.updateOne(
      { _id: missingStatusCert._id },
      { $unset: { status: 1 } }
    );

    const missingStatusDlRes = await makeRequest({
      path: `/certificate/download/${encodeURIComponent(missingStatusCertNum)}`,
      cookies: examCookies,
    });
    assert.strictEqual(missingStatusDlRes.statusCode, 403, 'Missing status must not be treated as valid');
    assert.ok(!(missingStatusDlRes.headers['content-type'] || '').includes('application/pdf'));
    console.log('  ✔ 9d Passed: Missing ExamCertificate status rejected cleanly (403).');

    // Verify MMC-2026-20072 was not modified or duplicated if pre-existing
    if (!created20072) {
      const postCheck = await CertificateStudent.findOne({ certificateNumber: 'MMC-2026-20072' }).lean();
      assert.strictEqual(postCheck.certificateNumber, 'MMC-2026-20072');
      assert.strictEqual(postCheck.isActive, true);
    }

    console.log('\n=============================================================');
    console.log('🎉 ALL 8 CERTIFICATE REGRESSION & SAFETY TESTS PASSED 100%!');
    console.log('=============================================================\n');
  } finally {
    ejs.renderFile = origRenderFile;
    QRCode.toString = origQrToString;
    if (cleanups.examCertIds.length) await ExamCertificate.deleteMany({ _id: { $in: cleanups.examCertIds } });
    if (cleanups.resultIds.length) await ExamResult.deleteMany({ _id: { $in: cleanups.resultIds } });
    if (cleanups.attemptIds.length) await ExamAttempt.deleteMany({ _id: { $in: cleanups.attemptIds } });
    if (cleanups.examIds.length) await Examination.deleteMany({ _id: { $in: cleanups.examIds } });
    if (cleanups.studentIds.length) await CertificateStudent.deleteMany({ _id: { $in: cleanups.studentIds } });
    if (cleanups.courseIds.length) await Course.deleteMany({ _id: { $in: cleanups.courseIds } });
    if (cleanups.emails.length) await EmailOTP.deleteMany({ email: { $in: cleanups.emails } });

    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
}

runCertificateRegressionTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Certificate regression test failed:', err);
    process.exit(1);
  });
