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
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const CertificateStudent = require('../models/CertificateStudent');
const Course = require('../models/Course');
const EmailOTP = require('../models/EmailOTP');
const { sendOTPEmail } = require('../services/email.service');

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
    const searchTerm = (cert || email || query || '').trim();

    if (searchTerm) {
      student = await CertificateStudent.findOne({
        $or: [
          { certificateNumber: searchTerm.toUpperCase() },
          { certificateNumber: searchTerm },
          { email: searchTerm.toLowerCase() },
        ],
        isActive: true,
      }).populate('courseId');

      // Block if certificate is disabled for this course
      if (student && student.courseId && !student.courseId.certificateEnabled) {
        student = null;
        req.flash('error', 'Certificate generation is currently disabled for this course.');
        try {
          const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
          const verifyUrl = `${baseUrl}/verify/${encodeURIComponent(student.certificateNumber)}`;
          student.qrCode = await QRCode.toString(verifyUrl, {
            type: 'svg',
            margin: 1,
            color: { dark: '#000000', light: '#ffffff' },
          });
        } catch (e) {
          student.qrCode = '';
        }
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
      issuedDate: new Date(),
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
        return res.redirect('/certificate');
      }

      const student = await CertificateStudent.findOne({
        $or: [
          { certificateNumber: trimmedQuery.toUpperCase() },
          { certificateNumber: trimmedQuery },
          { email: trimmedQuery.toLowerCase() },
        ],
        isActive: true,
      });

      if (!student) {
        req.flash('error', `No certificate found matching "${trimmedQuery}". You can submit a request below.`);
        return res.redirect(`/certificate?query=${encodeURIComponent(trimmedQuery)}&notfound=1`);
      }

      return res.redirect(`/certificate?cert=${encodeURIComponent(student.certificateNumber)}`);
    }

    // ── Action 2: Request Certificate ──
    if (!fullName || !fullName.trim()) {
      req.flash('error', 'Please enter your full name.');
      return res.redirect('/certificate');
    }

    if (!email || !email.trim()) {
      req.flash('error', 'Please enter your email address.');
      return res.redirect('/certificate');
    }

    if (!courseId) {
      req.flash('error', 'Please select the completed course.');
      return res.redirect('/certificate');
    }

    const course = await Course.findById(courseId);
    if (!course) {
      req.flash('error', 'Selected course does not exist.');
      return res.redirect('/certificate');
    }

    // Block if certificate is disabled for this course
    if (!course.certificateEnabled) {
      req.flash('error', 'Certificate generation is currently disabled for this course.');
      return res.redirect('/certificate');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if student already has a certificate for this course
    let student = await CertificateStudent.findOne({
      email: normalizedEmail,
      courseId: course._id,
    }).populate('courseId');

    if (student) {
      req.flash('success', `Certificate record located! Certificate Number: ${student.certificateNumber}`);
      return res.redirect(`/certificate?cert=${encodeURIComponent(student.certificateNumber)}&msg=existing`);
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
    return res.redirect(`/certificate?cert=${encodeURIComponent(student.certificateNumber)}&msg=issued`);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /certificate/verify
 * Verify student eligibility by email.
 * Returns all active certificates for the given email address.
 * REQUIRES OTP session — user must have verified their email via OTP first.
 */
exports.verifyCertificate = async (req, res, next) => {
  try {
    const { email = '' } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail) {
      req.flash('error', 'Please enter your email address to verify.');
      return res.redirect('/certificate');
    }

    // ── OTP Guard: ensure user has verified this email via OTP ──
    if (!validateOTPGuard(req) ||
      req.session.certificateVerifiedEmail !== normalizedEmail) {
      // Not yet verified — redirect to OTP flow
      req.flash('error', 'Please verify your email with OTP first (or your session may have expired).');
      return res.redirect('/certificate');
    }

    // Find all active certificates for this email
    const students = await CertificateStudent.find({
      email: normalizedEmail,
      isActive: true,
    }).populate('courseId').sort({ createdAt: -1 });

    if (!students || students.length === 0) {
      req.flash('error', `No certificate found for "${email}". Please check your email or request a new certificate below.`);
      return res.redirect('/certificate?notfound=1');
    }

    // Load courses for the request form
    const courses = await Course.find({ isActive: true, certificateEnabled: true }).sort({ title: 1 });

    res.render('course/certificate', {
      title: 'Your Certificates — Maths Manthra',
      courses,
      selectedCourse: null,
      selectedCourseSlug: '',
      student: null,
      verifiedStudents: students,
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
 * Generate and download official PDF certificate securely using Puppeteer.
 * Fetches verified certificate, student, and course data directly from MongoDB.
 * REQUIRES OTP session — user must have verified their email via OTP first.
 */
exports.downloadCertificate = async (req, res, next) => {
  let browser = null;
  try {
    const { certificateId } = req.params;
    const certParam = (certificateId || '').trim();

    console.log('DOWNLOAD REQUEST RECEIVED');
    console.log('CERTIFICATE ID:', certificateId);

    if (!certParam) {
      req.flash('error', 'Certificate ID is required.');
      return res.redirect('/certificate');
    }

    // ── OTP Guard: ensure user has verified their email via OTP ──
    if (!validateOTPGuard(req)) {
      req.flash('error', 'Please verify your email with OTP before downloading (session may have expired).');
      return res.redirect('/certificate');
    }

    const query = [
      { certificateNumber: certParam.toUpperCase() },
      { certificateNumber: certParam },
    ];

    if (mongoose.Types.ObjectId.isValid(certParam)) {
      query.push({ _id: certParam });
    }

    const student = await CertificateStudent.findOne({
      $or: query,
      isActive: true,
    }).populate('courseId');

    const certificate = student;
    console.log('CERTIFICATE FOUND:', certificate ? true : false);

    if (!student) {
      return res.status(404).render('404', {
        title: 'Certificate Not Found — Maths Manthra',
        message: 'The requested certificate could not be found.',
      });
    }

    // Ensure the verified email matches the certificate's email
    if (req.session.certificateVerifiedEmail !== student.email) {
      req.flash('error', 'You can only download certificates associated with your verified email.');
      return res.redirect('/certificate');
    }

    // Direct access protection: check if certificates are enabled for this course
    if (student.courseId && student.courseId.certificateEnabled === false) {
      return res.status(403).send('Certificate generation is currently disabled for this course.');
    }

    // Dynamic dates
    const issuedDate = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const certDateLong = student.courseId && student.courseId.certificateCompletionDate
      ? new Date(student.courseId.certificateCompletionDate)
      : null;
    const completionDate = certDateLong
      ? certDateLong.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      : 'Date Not Assigned';

    // Verification URL for QR code
    const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
    const verifyUrl = `${baseUrl}/verify/${encodeURIComponent(student.certificateNumber)}`;
    const qrCodeSvg = await QRCode.toString(verifyUrl, {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    // Template assets
    const { bgDataUri, sigDataUri } = getCertificateAssets();

    // Render HTML template
    const templatePath = path.join(__dirname, '../views/course/certificate-pdf.ejs');
    const html = await ejs.renderFile(templatePath, {
      bgImagePath: bgDataUri,
      signaturePath: sigDataUri,
      qrCode: qrCodeSvg,
      studentName: student.fullName || student.name || 'Student',
      issuedDate,
      certificateNumber: student.certificateNumber,
      completionDate,
    });

    console.log('GENERATING PDF...');

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0',
    });

    const rawPdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
    });

    // Convert Puppeteer Uint8Array to a Node.js Buffer
    // This prevents Express res.send() from serializing Uint8Array as a JSON object
    const pdfBuffer = Buffer.from(rawPdf);

    console.log('PDF BUFFER EXISTS:', !!pdfBuffer);
    console.log('PDF BUFFER SIZE:', pdfBuffer?.length);

    if (pdfBuffer) {
      console.log('FIRST 20 BYTES:', pdfBuffer.slice(0, 20).toString());
    }

    // Save temporary copy to disk for manual inspection and verification
    try {
      fs.writeFileSync('debug-certificate.pdf', pdfBuffer);
    } catch (fsErr) {
      console.warn('Could not save debug-certificate.pdf:', fsErr.message);
    }

    const filename = `MathsManthra-Certificate-${student.certificateNumber}`;

    console.log('SETTING PDF HEADERS');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    console.log('SENDING PDF RESPONSE');
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('Error generating certificate PDF:', err);
    return next(err);
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
