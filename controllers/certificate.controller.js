/**
 * controllers/certificate.controller.js
 * Public-facing certificate request and verification controller.
 * Accessible to all students without requiring login.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const ejs = require('ejs');
const QRCode = require('qrcode');
const CertificateStudent = require('../models/CertificateStudent');
const Course = require('../models/Course');
const ExamCertificate = require('../models/ExamCertificate');
const EmailOTP = require('../models/EmailOTP');
const { sendOTPEmail } = require('../services/email.service');

/**
 * Safe redirect helper for serverless / Vercel environments.
 * Awaits session persistence before responding with HTTP 303 See Other.
 */
function safeRedirect(req, res, targetUrl, next) {
  if (res.headersSent) {
    return;
  }
  const errorHandler = typeof next === 'function' ? next : (typeof req.next === 'function' ? req.next : null);
  if (req.session && typeof req.session.save === 'function') {
    return req.session.save((err) => {
      if (err) {
        console.error('[Certificate] Session save error during safeRedirect:', err.message);
        if (errorHandler) {
          return errorHandler(err);
        }
        if (!res.headersSent) {
          return res.status(500).send('Session persistence failure');
        }
        return;
      }
      if (!res.headersSent) {
        return res.redirect(303, targetUrl);
      }
    });
  }
  return res.redirect(303, targetUrl);
}

/**
 * Push a UI error message directly into res.locals.error for non-redirect renders.
 */
function pushLocalError(res, message) {
  if (!message) return;
  const existing = Array.isArray(res.locals.error) ? res.locals.error : [];
  if (!existing.includes(message)) {
    res.locals.error = [...existing, message];
  }
}

/**
 * Safely generate an inline SVG QR code for a certificate verification target.
 * Returns empty string on missing target or QR generation failure (never mutates null).
 */
async function generateSafeQrSvg(req, verifyTarget) {
  const cleanTarget = String(verifyTarget || '').trim();
  if (!cleanTarget) {
    return '';
  }
  try {
    const rawAppUrl = (process.env.APP_URL || '').trim();
    const host = req && typeof req.get === 'function' ? req.get('host') : '';
    const baseUrl = rawAppUrl
      ? rawAppUrl.replace(/\/$/, '')
      : (host ? `${req.protocol || 'https'}://${host}` : '');
    const verifyUrl = `${baseUrl}/verify/${encodeURIComponent(cleanTarget)}`;
    return await QRCode.toString(verifyUrl, {
      type: 'svg',
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    console.warn('[Certificate] QR code generation error:', err.message);
    return '';
  }
}

function formatShortDate(value) {
  const d = value ? new Date(value) : new Date();
  const safeDate = isNaN(d.getTime()) ? new Date() : d;
  return safeDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatLongDate(value, fallback = 'Date Not Assigned') {
  if (!value) return fallback;
  const d = new Date(value);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Resolve an active course certificate (CertificateStudent) or examination certificate (ExamCertificate)
 * without ever issuing new certificate numbers or mutating database records.
 */
async function resolveCertificateRecord(rawIdentifier, { allowEmail = false } = {}) {
  const identifier = String(rawIdentifier || '').trim();
  if (!identifier) {
    return { kind: 'empty' };
  }

  const courseQueries = [
    { certificateNumber: identifier.toUpperCase() },
    { certificateNumber: identifier },
  ];
  if (allowEmail) {
    courseQueries.push({ email: identifier.toLowerCase() });
  }
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    courseQueries.push({ _id: identifier });
  }

  const studentDoc = await CertificateStudent.findOne({
    $or: courseQueries,
    isActive: true,
  }).populate('courseId');

  if (studentDoc) {
    if (!studentDoc.courseId) {
      return {
        kind: 'missing_relation',
        message: 'The course record associated with this certificate could not be found.',
      };
    }

    const certNum = (studentDoc.certificateNumber || '').trim();
    const verifyTarget = certNum || (studentDoc.studentId || '').trim();
    const issuedDate = studentDoc.issuedDate || studentDoc.createdAt || new Date();

    return {
      kind: 'course',
      record: studentDoc,
      certificateNumber: certNum,
      verifyTarget,
      studentName: studentDoc.fullName || studentDoc.name || 'Student',
      email: (studentDoc.email || '').toLowerCase().trim(),
      issuedDate: isNaN(new Date(issuedDate).getTime()) ? new Date() : new Date(issuedDate),
      completionDateValue: studentDoc.courseId.certificateCompletionDate || null,
      courseTitle: studentDoc.courseId.title || 'Course',
    };
  }

  // Fallback: check ExamCertificate collection (new examination certificate system)
  const examQueries = [
    { certificateNumber: identifier.toUpperCase() },
    { certificateNumber: identifier },
    { verificationToken: identifier },
    { verificationToken: identifier.toLowerCase() },
  ];
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    examQueries.push({ _id: identifier });
  }

  const examCert = await ExamCertificate.findOne({ $or: examQueries })
    .populate('studentId')
    .populate('examinationId')
    .lean();

  if (examCert) {
    if (examCert.status === 'revoked') {
      return {
        kind: 'revoked',
        message: `Certificate "${examCert.certificateNumber}" has been officially revoked.${examCert.revocationReason ? ' Reason: ' + examCert.revocationReason : ''}`,
      };
    }

    if (examCert.status !== 'valid') {
      return {
        kind: 'invalid_status',
        message: `Certificate "${examCert.certificateNumber || ''}" is currently unavailable (status is not valid).`,
      };
    }

    if (!examCert.studentId || examCert.studentId.isActive === false) {
      return {
        kind: 'missing_relation',
        message: 'The student record associated with this examination certificate could not be found.',
      };
    }

    if (!examCert.examinationId) {
      return {
        kind: 'missing_relation',
        message: 'The examination record associated with this certificate could not be found.',
      };
    }

    const issuedDate = examCert.issueDate || examCert.createdAt || new Date();
    return {
      kind: 'exam',
      record: examCert,
      certificateNumber: (examCert.certificateNumber || '').trim(),
      verifyTarget: (examCert.verificationToken || examCert.certificateNumber || '').trim(),
      studentName: examCert.studentId.fullName || examCert.studentId.name || 'Student',
      email: (examCert.studentId.email || '').toLowerCase().trim(),
      issuedDate: isNaN(new Date(issuedDate).getTime()) ? new Date() : new Date(issuedDate),
      completionDateValue: issuedDate,
      courseTitle: examCert.examinationId.title || 'Certification Examination',
    };
  }

  return { kind: 'not_found' };
}

let puppeteerInstance = null;

/**
 * Dynamically import Puppeteer to support ES module packaging across all Node runtimes
 * (e.g. Vercel Node 18/20) without breaking CommonJS module systems.
 */
async function getPuppeteer() {
  if (!puppeteerInstance) {
    const puppeteerModule = await import('puppeteer');
    puppeteerInstance = puppeteerModule.default || puppeteerModule;
  }
  return puppeteerInstance;
}

const OTP_SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function validateOTPGuard(req) {
  if (!req.session.certificateVerifiedEmail) {
    return false;
  }

  if (req.session.certificateVerifiedAt && (Date.now() - req.session.certificateVerifiedAt > OTP_SESSION_TIMEOUT)) {
    // Expired
    delete req.session.certificateVerifiedEmail;
    delete req.session.certificateVerifiedAt;
    return false;
  }

  return true;
}

let cachedBgDataUri = null;
let cachedSigDataUri = null;

function getCertificateAssets() {
  if (!cachedBgDataUri) {
    const bgPath = path.join(__dirname, '../public/images/certificate-template.jpg');
    if (fs.existsSync(bgPath)) {
      cachedBgDataUri = 'data:image/jpeg;base64,' + fs.readFileSync(bgPath).toString('base64');
    }
  }
  if (!cachedSigDataUri) {
    const sigPath = path.join(__dirname, '../public/images/Signature_smija.png');
    if (fs.existsSync(sigPath)) {
      cachedSigDataUri = 'data:image/png;base64,' + fs.readFileSync(sigPath).toString('base64');
    }
  }
  return { bgDataUri: cachedBgDataUri, sigDataUri: cachedSigDataUri };
}

/**
 * Generate a collision-resistant unique certificate number
 * Format: MMC-YYYY-HEX6-RAND4 (e.g. MMC-2026-F4C91A-4819)
 */
async function generateUniqueCertificateNumber() {
  const year = new Date().getFullYear();
  let certNumber = '';
  let exists = true;
  let attempts = 0;

  while (exists && attempts < 10) {
    attempts++;
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    certNumber = `MMC-${year}-${randomHex}-${randomSeq}`;
    exists = await CertificateStudent.exists({ certificateNumber: certNumber });
  }

  return certNumber;

}

/**
 * GET /certificate
 * Public certificate portal — search, view, or request completion certificates.
 */
exports.showCertificatePage = async (req, res, next) => {
  try {
    const { course: courseSlug = '', cert = '', email = '', query = '', msg = '', reverify = '' } = req.query;

    if (reverify === '1') {
      delete req.session.certificateVerifiedEmail;
      delete req.session.certificateVerifiedAt;
      return res.redirect(`/certificate${courseSlug ? '?course=' + courseSlug : ''}`);
    }

    const courses = await Course.find({ isActive: true, certificateEnabled: true }).sort({ title: 1 });

    // Pre-select course if slug provided
    let selectedCourse = null;
    if (courseSlug) {
      selectedCourse = courses.find(c => c.slug === courseSlug) || null;
    }

    // Check if student certificate requested via cert number, email, or query
    let student = null;
    let displayIssuedDate = new Date();
    const searchTerm = (cert || email || query || '').trim();

    if (searchTerm) {
      const resolved = await resolveCertificateRecord(searchTerm, { allowEmail: true });

      if (resolved.kind === 'course' || resolved.kind === 'exam') {
        const qrCodeSvg = await generateSafeQrSvg(req, resolved.verifyTarget);
        displayIssuedDate = resolved.issuedDate;
        student = {
          fullName: resolved.studentName,
          name: resolved.studentName,
          email: resolved.email,
          certificateNumber: resolved.certificateNumber,
          verifyTarget: resolved.verifyTarget,
          issuedDate: resolved.issuedDate,
          courseId: {
            title: resolved.courseTitle,
            certificateCompletionDate: resolved.completionDateValue,
          },
          qrCode: qrCodeSvg,
          isExamCertificate: resolved.kind === 'exam',
        };
      } else if (resolved.kind === 'revoked' || resolved.kind === 'invalid_status' || resolved.kind === 'missing_relation') {
        student = null;
        pushLocalError(res, resolved.message);
      } else if (resolved.kind === 'not_found') {
        student = null;
        pushLocalError(res, `No active certificate found matching "${searchTerm}".`);
      }
    }

    res.render('course/certificate', {
      title: 'Course Certificate Portal — Maths Manthra',
      courses,
      selectedCourse,
      selectedCourseSlug: courseSlug,
      student,
      verifiedStudents: [],
      verifiedEmail: '',
      searchTerm,
      msg,
      issuedDate: displayIssuedDate,
      otpVerified: validateOTPGuard(req),
      layout: false,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /certificate
 * Handle certificate search lookup or new certificate request.
 */
exports.handleCertificateAction = async (req, res, next) => {
  try {
    const { action = 'request', query = '', fullName, email, phone, qualification, courseId } = req.body;

    // ── Action 1: Search / Verify ──
    if (action === 'search') {
      const trimmedQuery = (query || '').trim();
      if (!trimmedQuery) {
        req.flash('error', 'Please enter your email or certificate number to search.');
        return safeRedirect(req, res, '/certificate', next);
      }

      const resolved = await resolveCertificateRecord(trimmedQuery, { allowEmail: true });

      if (resolved.kind === 'revoked' || resolved.kind === 'invalid_status' || resolved.kind === 'missing_relation') {
        req.flash('error', resolved.message);
        return safeRedirect(req, res, '/certificate', next);
      }

      if (resolved.kind === 'not_found' || !resolved.certificateNumber) {
        req.flash('error', `No certificate found matching "${trimmedQuery}". You can submit a request below.`);
        return safeRedirect(req, res, `/certificate?query=${encodeURIComponent(trimmedQuery)}&notfound=1`, next);
      }

      return safeRedirect(req, res, `/certificate?cert=${encodeURIComponent(resolved.certificateNumber)}`, next);
    }

    // ── Action 2: Request Certificate ──
    if (!fullName || !fullName.trim()) {
      req.flash('error', 'Please enter your full name.');
      return safeRedirect(req, res, '/certificate', next);
    }

    if (!email || !email.trim()) {
      req.flash('error', 'Please enter your email address.');
      return safeRedirect(req, res, '/certificate', next);
    }

    if (!courseId) {
      req.flash('error', 'Please select the completed course.');
      return safeRedirect(req, res, '/certificate', next);
    }

    const course = await Course.findById(courseId);
    if (!course) {
      req.flash('error', 'Selected course does not exist.');
      return safeRedirect(req, res, '/certificate', next);
    }

    // Block NEW certificate requests if certificate generation is disabled for this course
    if (!course.certificateEnabled) {
      req.flash('error', 'Certificate generation is currently disabled for this course.');
      return safeRedirect(req, res, '/certificate', next);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if student already has a certificate for this course
    let student = await CertificateStudent.findOne({
      email: normalizedEmail,
      courseId: course._id,
    }).populate('courseId');

    if (student) {
      req.flash('success', `Certificate record located! Certificate Number: ${student.certificateNumber}`);
      return safeRedirect(req, res, `/certificate?cert=${encodeURIComponent(student.certificateNumber)}&msg=existing`, next);
    }

    // Auto-generate certificate number
    const certificateNumber = await generateUniqueCertificateNumber();

    student = await CertificateStudent.create({
      fullName: fullName.trim(),
      name: fullName.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : '',
      qualification: qualification ? qualification.trim() : '',
      courseId: course._id,
      certificateNumber,
      issuedDate: new Date(),
      isActive: true,
    });

    req.flash('success', `Congratulations! Your certificate has been issued. Certificate Number: ${certificateNumber}`);
    return safeRedirect(req, res, `/certificate?cert=${encodeURIComponent(student.certificateNumber)}&msg=issued`, next);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /certificate/verify
 * Verify student eligibility by email.
 * Returns all active certificates (both course and examination) for the given email address.
 * REQUIRES OTP session — user must have verified their email via OTP first.
 */
exports.verifyCertificate = async (req, res, next) => {
  try {
    const { email = '' } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail) {
      req.flash('error', 'Please enter your email address to verify.');
      return safeRedirect(req, res, '/certificate', next);
    }

    // ── OTP Guard: ensure user has verified this email via OTP ──
    if (!validateOTPGuard(req) ||
      req.session.certificateVerifiedEmail !== normalizedEmail) {
      // Not yet verified — redirect to OTP flow
      req.flash('error', 'Please verify your email with OTP first (or your session may have expired).');
      return safeRedirect(req, res, '/certificate', next);
    }

    // Find all active student records for this email
    const matchingStudents = await CertificateStudent.find({
      email: normalizedEmail,
      isActive: true,
    }).populate('courseId').sort({ createdAt: -1 });

    const studentIds = matchingStudents.map(s => s._id);

    // Find valid examination certificates linked to these student records
    const examCerts = studentIds.length > 0
      ? await ExamCertificate.find({
        studentId: { $in: studentIds },
        status: 'valid',
      })
        .populate('studentId')
        .populate('examinationId')
        .sort({ issueDate: -1 })
      : [];

    const courseCertEntries = matchingStudents
      .filter(s => Boolean(s.certificateNumber && s.courseId))
      .map(s => ({
        fullName: s.fullName || s.name || 'Student',
        name: s.name || s.fullName || 'Student',
        email: s.email,
        certificateNumber: s.certificateNumber,
        verifyTarget: s.certificateNumber,
        issuedDate: s.issuedDate || s.createdAt,
        createdAt: s.createdAt,
        courseId: s.courseId,
      }));

    const examCertEntries = examCerts
      .filter(ec => Boolean(ec.certificateNumber && ec.studentId && ec.examinationId))
      .map(ec => ({
        fullName: ec.studentId.fullName || ec.studentId.name || 'Student',
        name: ec.studentId.name || ec.studentId.fullName || 'Student',
        email: ec.studentId.email,
        certificateNumber: ec.certificateNumber,
        verifyTarget: ec.verificationToken || ec.certificateNumber,
        issuedDate: ec.issueDate || ec.createdAt,
        createdAt: ec.createdAt,
        courseId: {
          title: ec.examinationId.title || 'Certification Examination',
        },
      }));

    const verifiedStudents = [...courseCertEntries, ...examCertEntries];

    if (verifiedStudents.length === 0) {
      req.flash('error', `No certificate found for "${email}". Please check your email or request a new certificate below.`);
      return safeRedirect(req, res, '/certificate?notfound=1', next);
    }

    // Load courses for the request form
    const courses = await Course.find({ isActive: true, certificateEnabled: true }).sort({ title: 1 });

    res.render('course/certificate', {
      title: 'Your Certificates — Maths Manthra',
      courses,
      selectedCourse: null,
      selectedCourseSlug: '',
      student: null,
      verifiedStudents,
      verifiedEmail: normalizedEmail,
      searchTerm: '',
      msg: '',
      issuedDate: new Date(),
      otpVerified: true,
      layout: false,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /certificate/download/:certificateId
 * Generate and download official PDF certificate using Puppeteer.
 * Supports both existing course certificates (CertificateStudent) and examination certificates (ExamCertificate).
 * REQUIRES OTP session — user must have verified their email via OTP first.
 */
exports.downloadCertificate = async (req, res, next) => {
  let browser = null;
  try {
    const { certificateId } = req.params;
    const certParam = (certificateId || '').trim();

    if (!certParam) {
      req.flash('error', 'Certificate ID is required.');
      return safeRedirect(req, res, '/certificate', next);
    }

    // ── OTP Guard: ensure user has verified their email via OTP ──
    if (!validateOTPGuard(req)) {
      req.flash('error', 'Please verify your email with OTP before downloading (session may have expired).');
      return safeRedirect(req, res, '/certificate', next);
    }

    const resolved = await resolveCertificateRecord(certParam, { allowEmail: false });

    if (resolved.kind === 'not_found' || resolved.kind === 'empty') {
      return res.status(404).render('404', {
        title: 'Certificate Not Found — Maths Manthra',
        message: 'The requested certificate could not be found.',
        currentUser: null,
        layout: false,
      });
    }

    if (resolved.kind === 'revoked') {
      return res.status(403).send(resolved.message);
    }

    if (resolved.kind === 'invalid_status') {
      return res.status(403).send(resolved.message);
    }

    if (resolved.kind === 'missing_relation' || !resolved.certificateNumber) {
      return res.status(404).render('404', {
        title: 'Certificate Unavailable — Maths Manthra',
        message: resolved.message || 'The requested certificate record is missing required details.',
        currentUser: null,
        layout: false,
      });
    }

    // Ensure the verified email matches the certificate's email
    const verifiedEmail = (req.session.certificateVerifiedEmail || '').toLowerCase().trim();
    if (!resolved.email || verifiedEmail !== resolved.email) {
      req.flash('error', 'You can only download certificates associated with your verified email.');
      return safeRedirect(req, res, '/certificate', next);
    }

    // Dynamic dates
    const issuedDate = formatShortDate(resolved.issuedDate);
    const completionDate = formatLongDate(resolved.completionDateValue, 'Date Not Assigned');

    // Verification URL for QR code (safely defaults to '' if QR generation fails)
    const qrCodeSvg = await generateSafeQrSvg(req, resolved.verifyTarget);

    // Template assets
    const { bgDataUri, sigDataUri } = getCertificateAssets();

    // Render HTML template
    const templatePath = path.join(__dirname, '../views/course/certificate-pdf.ejs');
    const html = await ejs.renderFile(templatePath, {
      bgImagePath: bgDataUri || '',
      signaturePath: sigDataUri || '',
      qrCode: qrCodeSvg || '',
      studentName: resolved.studentName,
      issuedDate,
      certificateNumber: resolved.certificateNumber,
      completionDate,
    });

    // ── Launch Puppeteer ──
    const puppeteer = await getPuppeteer();

    // Auto-detect Chromium: use system binary in production (Docker Alpine),
    // or @sparticuz/chromium on Vercel/Lambda if available,
    // fall back to Puppeteer's bundled Chromium in development.
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      timeout: 30000,
    };

    // 1. Check for system Chromium (production Docker container)
    const systemChromium = '/usr/bin/chromium-browser';
    if (fs.existsSync(systemChromium)) {
      launchOptions.executablePath = systemChromium;
    } else {
      // 2. Check for @sparticuz/chromium if running in AWS Lambda / Vercel Serverless
      try {
        const chromium = require('@sparticuz/chromium');
        if (chromium && (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)) {
          launchOptions.executablePath = await chromium.executablePath();
          launchOptions.args = chromium.args || launchOptions.args;
          launchOptions.headless = chromium.headless !== undefined ? chromium.headless : true;
        }
      } catch (_) {
        // Fall back to Puppeteer's default bundled Chromium
      }
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 15000,
    });

    const pdfBuffer = Buffer.from(await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    }));

    // Close browser immediately after PDF generation
    await browser.close().catch(() => { });
    browser = null;

    // ── Send PDF with maximum browser compatibility headers ──
    const safeFileCert = resolved.certificateNumber.replace(/[^A-Za-z0-9\-_.]/g, '_');
    const filename = `MathsManthra-Certificate-${safeFileCert}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });

    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[PDF Download] Error generating certificate:', err.message);
    req.flash('error', 'Failed to generate certificate PDF. Please try again.');
    return safeRedirect(req, res, '/certificate', next);
  } finally {
    if (browser) {
      await browser.close().catch(() => { });
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// OTP VERIFICATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a cryptographically secure 6-digit OTP.
 */
function generateOTP() {
  // crypto.randomInt generates a uniform random integer in [0, 1000000)
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * POST /certificate/send-otp
 * Send a 6-digit OTP to the student's email address.
 * Rate limited in routes (5 requests/hour/IP).
 */
exports.sendOTP = async (req, res, next) => {
  try {
    const { email = '' } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required.',
      });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }

    // Check if an unexpired OTP already exists (prevent spam)
    const existingOTP = await EmailOTP.findOne({
      email: normalizedEmail,
      verified: false,
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) }, // within last 60 seconds
    });

    if (existingOTP) {
      return res.status(429).json({
        success: false,
        message: 'An OTP was sent recently. Please wait 60 seconds before requesting again.',
      });
    }

    // Invalidate any previous unused OTPs for this email
    await EmailOTP.deleteMany({ email: normalizedEmail, verified: false });

    // Generate and store new OTP
    const otp = generateOTP();
    await EmailOTP.create({
      email: normalizedEmail,
      otp,
    });

    // Send OTP email
    await sendOTPEmail(normalizedEmail, otp);

    // Store email in session for the verification step
    req.session.otpPendingEmail = normalizedEmail;

    console.log(`[OTP] Sent to ${normalizedEmail}`);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully! Check your email inbox (and spam folder).',
    });
  } catch (err) {
    console.error('[OTP] Send error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again later.',
    });
  }
};

/**
 * POST /certificate/verify-otp
 * Verify the submitted OTP code.
 * On success, sets req.session.certificateVerifiedEmail.
 */
exports.verifyOTP = async (req, res, next) => {
  try {
    const { email = '', otp = '' } = req.body;
    const normalizedEmail = email.toLowerCase().trim();
    const trimmedOTP = otp.trim();

    if (!normalizedEmail || !trimmedOTP) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required.',
      });
    }

    // Find the most recent unexpired OTP for this email
    const otpRecord = await EmailOTP.findOne({
      email: normalizedEmail,
      verified: false,
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired or was not found. Please request a new OTP.',
      });
    }

    // Check max attempts
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await EmailOTP.deleteOne({ _id: otpRecord._id });
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new OTP.',
      });
    }

    // Increment attempt counter
    otpRecord.attempts += 1;
    await otpRecord.save();

    const storedOtp = otpRecord.otp;
    const enteredOtp = trimmedOTP;
    const isLengthMatch = Buffer.from(enteredOtp).length === Buffer.from(storedOtp).length;
    const result = isLengthMatch && crypto.timingSafeEqual(
      Buffer.from(enteredOtp),
      Buffer.from(storedOtp)
    );

    console.log('Stored OTP:', storedOtp);
    console.log('Entered OTP:', enteredOtp);
    console.log('OTP MATCH:', result);

    if (!result) {
      const remaining = otpRecord.maxAttempts - otpRecord.attempts;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      });
    }

    // Mark OTP as verified and clean up
    otpRecord.verified = true;
    await otpRecord.save();

    // Check required session fields before assignments
    console.log('req.session.otpVerified (before):', req.session.otpVerified);
    console.log('req.session.verifiedEmail (before):', req.session.verifiedEmail);
    console.log('req.session.courseSlug (before):', req.session.courseSlug);

    // Set session as verified
    req.session.certificateVerifiedEmail = normalizedEmail;
    req.session.certificateVerifiedAt = Date.now();
    req.session.otpVerified = true;
    req.session.verifiedEmail = normalizedEmail;
    req.session.courseSlug = req.body.courseSlug || null;

    // Clean up pending
    delete req.session.otpPendingEmail;

    console.log('Before save:', req.session);
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    console.log('After save:', req.session);

    console.log(`[OTP] Verified for ${normalizedEmail}`);

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully!',
      email: normalizedEmail,
    });
  } catch (err) {
    console.error('[OTP] Verify error:', err);
    return res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.',
    });
  }
};

/**
 * POST /certificate/resend-otp
 * Resend OTP to the same email. Invalidates previous OTPs.
 * Rate limited in routes (5 requests/hour/IP).
 */
exports.resendOTP = async (req, res, next) => {
  try {
    const { email = '' } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required.',
      });
    }

    // Check cooldown (60 seconds between resends)
    const recentOTP = await EmailOTP.findOne({
      email: normalizedEmail,
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
    });

    if (recentOTP) {
      return res.status(429).json({
        success: false,
        message: 'Please wait 60 seconds before requesting a new OTP.',
      });
    }

    // Invalidate old OTPs
    await EmailOTP.deleteMany({ email: normalizedEmail, verified: false });

    // Generate new OTP
    const otp = generateOTP();
    await EmailOTP.create({
      email: normalizedEmail,
      otp,
    });

    // Send
    await sendOTPEmail(normalizedEmail, otp);

    console.log(`[OTP] Resent to ${normalizedEmail}`);

    return res.status(200).json({
      success: true,
      message: 'New OTP sent successfully!',
    });
  } catch (err) {
    console.error('[OTP] Resend error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend OTP. Please try again.',
    });
  }
};
