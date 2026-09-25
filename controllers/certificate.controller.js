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
    const { course: courseSlug = '', cert = '', email = '', query = '', msg = '' } = req.query;

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
      } else if (student) {
        try {
          const verifyUrl = `${req.protocol}://${req.get('host')}/certificate?cert=${encodeURIComponent(student.certificateNumber)}`;
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
 */
exports.verifyCertificate = async (req, res, next) => {
  try {
    const { email = '' } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail) {
      req.flash('error', 'Please enter your email address to verify.');
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
    const courses = await Course.find({ isActive: true }).sort({ title: 1 });

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
 */
exports.downloadCertificate = async (req, res, next) => {
  let browser = null;
  try {
    const { certificateId } = req.params;
    const certParam = (certificateId || '').trim();

    if (!certParam) {
      req.flash('error', 'Certificate ID is required.');
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

    if (!student) {
      return res.status(404).render('404', {
        title: 'Certificate Not Found — Maths Manthra',
        message: 'The requested certificate could not be found.',
      });
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
    const verifyUrl = `${req.protocol}://${req.get('host')}/certificate?cert=${encodeURIComponent(student.certificateNumber)}`;
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

    // Generate PDF using Puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0',
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
    });

    const filename = `MathsManthra-Certificate-${student.certificateNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating certificate PDF:', err);
    return next(err);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};
