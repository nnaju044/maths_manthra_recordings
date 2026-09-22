/**
 * controllers/certificate.controller.js
 * Public-facing certificate request and verification controller.
 * Accessible to all students without requiring login.
 */
const crypto = require('crypto');
const CertificateStudent = require('../models/CertificateStudent');
const Course = require('../models/Course');

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

    const courses = await Course.find({ isActive: true }).sort({ title: 1 });

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
    }

    res.render('course/certificate', {
      title: 'Course Certificate Portal — Maths Manthra',
      courses,
      selectedCourse,
      selectedCourseSlug: courseSlug,
      student,
      searchTerm,
      msg,
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
