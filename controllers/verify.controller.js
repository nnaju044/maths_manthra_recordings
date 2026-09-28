/**
 * controllers/verify.controller.js
 * Public Certificate Verification Controller
 * 
 * Handles public-facing verification requests for certificates issued by Maths Manthra Academy.
 * Strictly sanitizes data to prevent exposure of MongoDB IDs, admin data, or session internals.
 */

const CertificateStudent = require('../models/CertificateStudent');

// Regular expression to validate certificate number format (alphanumeric, hyphens, underscores)
const CERT_REGEX = /^[A-Za-z0-9\-_]{3,100}$/;

/**
 * GET /verify/:certificateNumber
 * Public endpoint to verify a student certificate.
 */
exports.verifyCertificatePublic = async (req, res, next) => {
  try {
    const rawCertNumber = req.params.certificateNumber || '';
    const certificateNumber = String(rawCertNumber).trim();

    // Basic format validation
    if (!certificateNumber || !CERT_REGEX.test(certificateNumber)) {
      return res.status(404).render('verify', {
        layout: false,
        isValid: false,
        isSearchOnly: false,
        student: null,
        certificateNumber: certificateNumber || 'Unknown',
        errorMessage: 'Invalid certificate number format. Please check the certificate number and try again.',
        pageTitle: 'Certificate Not Found | Maths Manthra Academy',
        metaDescription: 'Verify student certificates issued by Maths Manthra Academy.',
      });
    }

    // Lookup active student record
    const student = await CertificateStudent.findActiveByCertificateNumber(certificateNumber);

    // If record doesn't exist or is not active
    if (!student || student.isActive !== true) {
      return res.status(404).render('verify', {
        layout: false,
        isValid: false,
        isSearchOnly: false,
        student: null,
        certificateNumber,
        errorMessage: `No active certificate was found for certificate number "${certificateNumber}". The certificate may be invalid, expired, or deactivated.`,
        pageTitle: 'Certificate Not Found | Maths Manthra Academy',
        metaDescription: 'Verify student certificates issued by Maths Manthra Academy.',
      });
    }

    // Format issue date nicely
    let formattedIssueDate = 'N/A';
    if (student.issuedDate) {
      const d = new Date(student.issuedDate);
      if (!isNaN(d.getTime())) {
        formattedIssueDate = d.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      }
    }

    // Format profile image URL if hosted on Google Drive
    let formattedProfileImage = '';
    if (student.profileImage && typeof student.profileImage === 'string') {
      const trimmed = student.profileImage.trim();
      const openMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (openMatch && openMatch[1]) {
        formattedProfileImage = `https://drive.google.com/thumbnail?id=${openMatch[1]}&sz=w400`;
      } else if (fileMatch && fileMatch[1]) {
        formattedProfileImage = `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w400`;
      } else {
        formattedProfileImage = trimmed;
      }
    }

    // Strictly whitelist allowed fields — NEVER expose MongoDB IDs, admin data, or internal flags
    const safeStudent = {
      fullName: student.fullName || student.name || 'Verified Student',
      email: student.email || '',
      phone: student.phone || '',
      studentId: student.studentId || '',
      certificateNumber: student.certificateNumber || certificateNumber,
      issueDate: formattedIssueDate,
      marks: (typeof student.marks === 'number' && !isNaN(student.marks)) ? student.marks : null,
      progressCard: student.progressCard || '',
      profileImage: formattedProfileImage,
      verificationStatus: student.verificationStatus !== false,
      courseTitle: (student.courseId && student.courseId.title) ? student.courseId.title : 'Maths Manthra Academy Program',
    };

    return res.render('verify', {
      layout: false,
      isValid: true,
      isSearchOnly: false,
      student: safeStudent,
      certificateNumber: safeStudent.certificateNumber,
      errorMessage: null,
      pageTitle: 'Verified Certificate | Maths Manthra Academy',
      metaDescription: 'Verify student certificates issued by Maths Manthra Academy.',
    });
  } catch (err) {
    console.error('Error during certificate verification:', err);
    return res.status(500).render('verify', {
      layout: false,
      isValid: false,
      isSearchOnly: false,
      student: null,
      certificateNumber: req.params.certificateNumber || '',
      errorMessage: 'An error occurred while verifying this certificate. Please try again later.',
      pageTitle: 'Verification Error | Maths Manthra Academy',
      metaDescription: 'Verify student certificates issued by Maths Manthra Academy.',
    });
  }
};

/**
 * GET /verify
 * Public verification lookup search page.
 * If ?cert=... query is supplied, redirects to /verify/:cert
 */
exports.showVerifySearch = (req, res) => {
  const queryCert = (req.query.cert || req.query.certificateNumber || '').trim();
  if (queryCert) {
    return res.redirect(`/verify/${encodeURIComponent(queryCert)}`);
  }

  return res.render('verify', {
    layout: false,
    isValid: false,
    isSearchOnly: true,
    student: null,
    certificateNumber: '',
    errorMessage: null,
    pageTitle: 'Certificate Verification Portal | Maths Manthra Academy',
    metaDescription: 'Verify student certificates issued by Maths Manthra Academy.',
  });
};
