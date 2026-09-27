/**
 * scripts/playwright_audit.js
 * Comprehensive Playwright audit of Maths Manthra Certificate OTP Verification System.
 */
const { chromium } = require('playwright');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const EmailOTP = require('../models/EmailOTP');
const CertificateStudent = require('../models/CertificateStudent');
const Course = require('../models/Course');

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'nnaju044@gmail.com';
const TEST_CERT_NUM = 'MMC-2026-A09434-9710';
const OTHER_CERT_NUM = 'MMC-2026-213329-6234'; // Shahila's certificate

async function runAudit() {
  console.log('================================================================');
  console.log('  STARTING PLAYWRIGHT AUDIT: MATHS MANTHRA CERTIFICATE SYSTEM  ');
  console.log('================================================================\n');

  // Connect to MongoDB to inspect state directly
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB for state auditing\n');

  // Launch Playwright browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
  });
  const page = await context.newPage();

  const auditResults = {
    step3_sendOTP: {},
    step4_verifyOTP: {},
    step5_sessionSave: {},
    step6_sessionCookie: {},
    step7_protectedRoutes: {},
    step8_pdfDownload: {},
    step9_databaseState: {},
  };

  // Intercept and log all network requests & console events
  const networkLogs = [];
  page.on('request', req => {
    if (req.url().includes('/certificate')) {
      networkLogs.push(`[REQ] ${req.method()} ${req.url()}`);
    }
  });
  page.on('response', res => {
    if (res.url().includes('/certificate')) {
      networkLogs.push(`[RES] ${res.status()} ${res.url()}`);
    }
  });

  const browserConsoleLogs = [];
  page.on('console', msg => {
    browserConsoleLogs.push(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: VERIFY OTP SEND FLOW
    // ═══════════════════════════════════════════════════════════════════════
    console.log('─── STEP 3: TESTING OTP SEND FLOW ───');
    
    // Clear any previous OTP records for test email to avoid 60s cooldown block
    await EmailOTP.deleteMany({ email: TEST_EMAIL });

    console.log(`1. Navigating to ${BASE_URL}/certificate...`);
    await page.goto(`${BASE_URL}/certificate`, { waitUntil: 'networkidle' });

    console.log(`2. Entering test email: ${TEST_EMAIL}`);
    const emailInput = page.locator('#otpEmail');
    await emailInput.fill(TEST_EMAIL);

    console.log('3. Clicking "Send OTP" button (#btnSendOTP)...');
    
    // Capture network request and response for send-otp
    const [sendOtpRequest, sendOtpResponse] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/certificate/send-otp') && req.method() === 'POST'),
      page.waitForResponse(res => res.url().includes('/certificate/send-otp')),
      page.locator('#btnSendOTP').click(),
    ]);

    const sendOtpUrl = sendOtpRequest.url();
    const sendOtpPayload = sendOtpRequest.postDataJSON();
    const sendOtpStatus = sendOtpResponse.status();
    const sendOtpRespBody = await sendOtpResponse.json();

    console.log('   Request URL:', sendOtpUrl);
    console.log('   Request Payload:', JSON.stringify(sendOtpPayload));
    console.log('   Response Status:', sendOtpStatus);
    console.log('   Response Body:', JSON.stringify(sendOtpRespBody));

    auditResults.step3_sendOTP = {
      url: sendOtpUrl,
      payload: sendOtpPayload,
      status: sendOtpStatus,
      response: sendOtpRespBody,
      success: sendOtpStatus === 200 && sendOtpRespBody.success === true,
    };

    // Verify UI transitioned to Step 2
    await page.waitForSelector('#otpStep2', { state: 'visible', timeout: 5000 });
    const otpSentEmailText = await page.locator('#otpSentEmail').textContent();
    console.log('   UI Step 2 displayed. Email target:', otpSentEmailText.trim());

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: VERIFY OTP VALIDATION FLOW
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n─── STEP 4: TESTING OTP VALIDATION FLOW ───');
    
    // 1. Retrieve OTP from database
    const otpDoc = await EmailOTP.findOne({ email: TEST_EMAIL, verified: false }).sort({ createdAt: -1 });
    if (!otpDoc) {
      throw new Error(`No OTP record found in database for ${TEST_EMAIL}`);
    }
    const storedOtp = otpDoc.otp;
    console.log('1. Retrieved OTP from MongoDB:');
    console.log('   Document ID:', otpDoc._id.toString());
    console.log('   Stored OTP:', storedOtp);
    console.log('   Expires TTL at:', otpDoc.createdAt);
    console.log('   Current attempts:', otpDoc.attempts);

    // 2. Test Invalid OTP first
    console.log('2. Testing invalid OTP (000000)...');
    const otpInput = page.locator('#otpCode');
    await otpInput.fill('000000');
    
    const [invalidOtpReq, invalidOtpRes] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/certificate/verify-otp')),
      page.waitForResponse(res => res.url().includes('/certificate/verify-otp')),
      page.locator('#btnVerifyOTP').click(),
    ]);

    const invalidResp = await invalidOtpRes.json();
    console.log('   Invalid OTP Response:', invalidOtpRes.status(), JSON.stringify(invalidResp));
    
    // Check attempt counter in DB
    const otpAfterInvalid = await EmailOTP.findById(otpDoc._id);
    console.log('   DB attempts incremented to:', otpAfterInvalid.attempts);

    // 3. Test Valid OTP
    console.log(`3. Entering valid OTP: ${storedOtp}...`);
    await otpInput.fill(storedOtp);

    const [validOtpReq, validOtpRes] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/certificate/verify-otp')),
      page.waitForResponse(res => res.url().includes('/certificate/verify-otp')),
      page.locator('#btnVerifyOTP').click(),
    ]);

    const validStatus = validOtpRes.status();
    const validResp = await validOtpRes.json();
    console.log('   Valid OTP Response Status:', validStatus);
    console.log('   Valid OTP Response Body:', JSON.stringify(validResp));

    // Verify UI transitioned to Step 3
    await page.waitForSelector('#otpStep3', { state: 'visible', timeout: 5000 });
    console.log('   UI Step 3 displayed (Email Verified banner visible)');

    auditResults.step4_verifyOTP = {
      storedOtp,
      enteredValidOtp: storedOtp,
      validStatus,
      validResponse: validResp,
      invalidTest: { status: invalidOtpRes.status(), response: invalidResp },
      success: validStatus === 200 && validResp.success === true,
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: VERIFY SESSION SAVE
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n─── STEP 5: TESTING SESSION SAVE ───');

    // Retrieve active session from MongoDB
    const sessionDocs = await mongoose.connection.db.collection('sessions').find().toArray();
    console.log(`   Found ${sessionDocs.length} sessions in MongoDB`);
    
    let matchedSession = null;
    for (const s of sessionDocs) {
      const parsed = JSON.parse(s.session);
      if (parsed.certificateVerifiedEmail === TEST_EMAIL || parsed.verifiedEmail === TEST_EMAIL) {
        matchedSession = { id: s._id, session: parsed };
        break;
      }
    }

    if (matchedSession) {
      console.log('   Session Document ID in MongoDB:', matchedSession.id);
      console.log('   Session Data in MongoDB:', JSON.stringify(matchedSession.session, null, 2));
      console.log('   req.session.certificateVerifiedEmail:', matchedSession.session.certificateVerifiedEmail);
      console.log('   req.session.otpVerified:', matchedSession.session.otpVerified);
      console.log('   req.session.verifiedEmail:', matchedSession.session.verifiedEmail);
      console.log('   req.session.courseSlug:', matchedSession.session.courseSlug);
    } else {
      console.warn('   ⚠️ Could not find session with verified email in MongoDB!');
    }

    auditResults.step5_sessionSave = {
      matchedSessionExists: !!matchedSession,
      sessionData: matchedSession ? matchedSession.session : null,
      hasOtpVerified: matchedSession ? !!matchedSession.session.otpVerified : false,
      hasVerifiedEmail: matchedSession ? !!matchedSession.session.verifiedEmail : false,
      hasCertificateVerifiedEmail: matchedSession ? !!matchedSession.session.certificateVerifiedEmail : false,
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: VERIFY SESSION COOKIE
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n─── STEP 6: TESTING SESSION COOKIES VIA PLAYWRIGHT ───');

    const cookies = await context.cookies();
    console.log('   Browser Cookies:');
    console.log(JSON.stringify(cookies, null, 2));

    const connectSidCookie = cookies.find(c => c.name === 'connect.sid');
    console.log('   connect.sid found:', !!connectSidCookie);
    if (connectSidCookie) {
      console.log('   connect.sid value:', connectSidCookie.value);
      console.log('   connect.sid httpOnly:', connectSidCookie.httpOnly);
      console.log('   connect.sid secure:', connectSidCookie.secure);
      console.log('   connect.sid sameSite:', connectSidCookie.sameSite);
      console.log('   connect.sid domain:', connectSidCookie.domain);
      console.log('   connect.sid path:', connectSidCookie.path);
    }

    auditResults.step6_sessionCookie = {
      cookies,
      connectSidFound: !!connectSidCookie,
      cookieDetails: connectSidCookie,
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: VERIFY PROTECTED ROUTES
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n─── STEP 7: TESTING PROTECTED ROUTES ───');

    // 1. Submit form on Step 3 to access certificates list
    console.log('1. Submitting Step 3 form (POST /certificate/verify)...');
    const [certListRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/certificate/verify')),
      page.locator('#otpVerifiedForm button[type="submit"]').click(),
    ]);
    console.log('   POST /certificate/verify status:', certListRes.status());
    await page.waitForLoadState('networkidle');

    // Verify verified student cards are rendered
    const certCardCount = await page.locator('.verified-cert-card').count();
    console.log(`   Found ${certCardCount} certificate card(s) on verified page`);
    const cardText = await page.locator('.verified-results-section').textContent();
    console.log('   Card summary snippet:', cardText.replace(/\s+/g, ' ').slice(0, 150));

    // 2. Test downloading own certificate while verified
    console.log(`2. Testing GET /certificate/download/${TEST_CERT_NUM} WITH verification...`);
    const verifiedDownloadRes = await page.request.get(`${BASE_URL}/certificate/download/${TEST_CERT_NUM}`);
    console.log('   Verified Download Status:', verifiedDownloadRes.status());
    console.log('   Verified Download Content-Type:', verifiedDownloadRes.headers()['content-type']);

    // 3. Test downloading OTHER student's certificate while verified as TEST_EMAIL
    console.log(`3. Testing GET /certificate/download/${OTHER_CERT_NUM} (IDOR test: Shahila's cert as Najeeb)...`);
    const idorRes = await page.request.get(`${BASE_URL}/certificate/download/${OTHER_CERT_NUM}`, {
      maxRedirects: 0,
    });
    console.log('   IDOR Status (expected 302 redirect):', idorRes.status());
    console.log('   IDOR Location header:', idorRes.headers()['location']);

    // 4. Test routes in an UNVERIFIED (fresh) browser context (no session cookie)
    console.log('4. Testing protected routes WITHOUT verification in fresh context...');
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();

    // 4a. /certificate (portal)
    const unverifiedPortalRes = await freshPage.request.get(`${BASE_URL}/certificate`);
    console.log('   Unverified /certificate status:', unverifiedPortalRes.status());

    // 4b. /certificate/download/:id without verification
    const unverifiedDownloadRes = await freshPage.request.get(`${BASE_URL}/certificate/download/${TEST_CERT_NUM}`, {
      maxRedirects: 0,
    });
    console.log('   Unverified /certificate/download status (expected 302 redirect):', unverifiedDownloadRes.status());
    console.log('   Unverified /certificate/download Location:', unverifiedDownloadRes.headers()['location']);

    // 4c. /certificate/view/:id without verification
    const unverifiedViewRes = await freshPage.request.get(`${BASE_URL}/certificate/view/${TEST_CERT_NUM}`, {
      maxRedirects: 0,
    });
    console.log('   Unverified /certificate/view/:id status:', unverifiedViewRes.status());

    // 4d. /certificate/view/:id WITH verification
    const verifiedViewRes = await page.request.get(`${BASE_URL}/certificate/view/${TEST_CERT_NUM}`, {
      maxRedirects: 0,
    });
    console.log('   Verified /certificate/view/:id status:', verifiedViewRes.status());

    auditResults.step7_protectedRoutes = {
      verifiedCertPageCards: certCardCount,
      verifiedDownloadStatus: verifiedDownloadRes.status(),
      idorDownloadStatus: idorRes.status(),
      idorDownloadRedirect: idorRes.headers()['location'],
      unverifiedDownloadStatus: unverifiedDownloadRes.status(),
      unverifiedDownloadRedirect: unverifiedDownloadRes.headers()['location'],
      unverifiedViewStatus: unverifiedViewRes.status(),
      verifiedViewStatus: verifiedViewRes.status(),
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 8: VERIFY PDF DOWNLOAD SYSTEM
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n─── STEP 8: TESTING PDF DOWNLOAD SYSTEM ───');

    console.log('1. Triggering download via Playwright page.waitForEvent("download")...');
    const downloadPromise = page.waitForEvent('download');
    
    // Find download button for TEST_CERT_NUM
    await page.locator(`a[href="/certificate/download/${TEST_CERT_NUM}"]`).first().click();
    const download = await downloadPromise;

    const downloadUrl = download.url();
    const suggestedFilename = download.suggestedFilename();
    const downloadPath = path.join(__dirname, '../debug-playwright-download.pdf');
    await download.saveAs(downloadPath);

    console.log('   Download Request URL:', downloadUrl);
    console.log('   Suggested Filename:', suggestedFilename);
    console.log('   Saved to:', downloadPath);

    // Also fetch via API to inspect exact headers
    const pdfDirectRes = await page.request.get(`${BASE_URL}/certificate/download/${TEST_CERT_NUM}`);
    const pdfHeaders = pdfDirectRes.headers();
    const contentType = pdfHeaders['content-type'];
    const contentDisposition = pdfHeaders['content-disposition'];
    const contentLength = pdfHeaders['content-length'];

    console.log('   Content-Type:', contentType);
    console.log('   Content-Disposition:', contentDisposition);
    console.log('   Content-Length:', contentLength);

    // Read first bytes
    const pdfBuffer = fs.readFileSync(downloadPath);
    const firstBytesString = pdfBuffer.slice(0, 10).toString('utf-8');
    const isPdfMagicValid = firstBytesString.startsWith('%PDF');
    const isHtml = firstBytesString.includes('<!DOCTYPE') || firstBytesString.includes('<html');

    console.log('   Downloaded File Size:', pdfBuffer.length, 'bytes');
    console.log('   First 10 Bytes (UTF-8):', JSON.stringify(firstBytesString));
    console.log('   Begins with %PDF?', isPdfMagicValid);
    console.log('   Contains HTML tags instead?', isHtml);

    auditResults.step8_pdfDownload = {
      downloadUrl,
      suggestedFilename,
      contentType,
      contentDisposition,
      contentLength,
      fileSizeBytes: pdfBuffer.length,
      firstBytes: firstBytesString,
      isPdf: isPdfMagicValid,
      isHtml,
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 9: VERIFY DATABASE STATE
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n─── STEP 9: VERIFYING DATABASE STATE ───');

    // EmailOTP
    const dbOtp = await EmailOTP.findOne({ email: TEST_EMAIL }).sort({ createdAt: -1 });
    console.log('   EmailOTP Record:');
    if (dbOtp) {
      console.log('     email:', dbOtp.email);
      console.log('     verified:', dbOtp.verified);
      console.log('     attempts:', dbOtp.attempts);
      console.log('     createdAt:', dbOtp.createdAt);
    } else {
      console.log('     None found');
    }

    // CertificateStudent
    const dbStudent = await CertificateStudent.findOne({ email: TEST_EMAIL }).populate('courseId');
    console.log('   CertificateStudent Record:');
    if (dbStudent) {
      console.log('     name:', dbStudent.fullName);
      console.log('     email:', dbStudent.email);
      console.log('     certificateNumber:', dbStudent.certificateNumber);
      console.log('     course title:', dbStudent.courseId ? dbStudent.courseId.title : 'N/A');
      console.log('     course certificateEnabled:', dbStudent.courseId ? dbStudent.courseId.certificateEnabled : 'N/A');
      console.log('     isActive:', dbStudent.isActive);
    } else {
      console.log('     None found');
    }

    // Sessions collection
    const dbSession = await mongoose.connection.db.collection('sessions').findOne({
      session: { $regex: TEST_EMAIL },
    });
    console.log('   Session Store Record in MongoDB:');
    if (dbSession) {
      console.log('     Session ID:', dbSession._id);
      console.log('     Expires:', dbSession.expires);
      console.log('     Parsed Data:', JSON.parse(dbSession.session));
    } else {
      console.log('     None found');
    }

    auditResults.step9_databaseState = {
      emailOtp: dbOtp,
      student: dbStudent,
      session: dbSession ? JSON.parse(dbSession.session) : null,
    };

    console.log('\n================================================================');
    console.log('  AUDIT EXECUTION COMPLETE. DUMPING RESULTS JSON:');
    console.log('================================================================');
    console.log(JSON.stringify(auditResults, null, 2));

    fs.writeFileSync(path.join(__dirname, '../audit-results.json'), JSON.stringify(auditResults, null, 2));

  } catch (err) {
    console.error('❌ Audit execution failed with error:', err);
  } finally {
    await browser.close();
    await mongoose.disconnect();
  }
}

runAudit();
