/**
 * controllers/verify.controller.js
 * Public Certificate Verification Controller
 * 
 * Handles public-facing verification requests for certificates issued by Maths Manthra Academy.
 * Strictly sanitizes data to prevent exposure of MongoDB IDs, admin data, or session internals.
 */

const CertificateStudent = require('../models/CertificateStudent');

const QRCode = require('qrcode');

const crypto = require('crypto');

// Regular expression to validate identifier format (studentId, certificateNumber, alphanumeric with hyphens/slashes/dots)
const IDENTIFIER_REGEX = /^[A-Za-z0-9\-_\.\/]{2,100}$/;

/**
 * GET /verify/:studentId (or /verify/:certificateNumber)
 * Public read-only endpoint to verify student credential & progress.
 */
exports.verifyCertificatePublic = async (req, res, next) => {
  try {
    const rawIdentifier = req.params.studentId || req.params.certificateNumber || '';
    const identifier = String(rawIdentifier).trim();

    // Basic format validation
    if (!identifier || !IDENTIFIER_REGEX.test(identifier)) {
      return res.status(404).render('verify', {
        layout: false,
        isValid: false,
        isSearchOnly: false,
        student: null,
        certificateNumber: identifier || 'Unknown',
        errorMessage: 'Invalid verification identifier format. Please check the Student ID or Certificate Number and try again.',
        pageTitle: 'Student Not Found | Maths Manthra Academy',
        metaDescription: 'Verify student certificates and progress reports issued by Maths Manthra Academy.',
      });
    }

    // Lookup active student record by studentId, certificateNumber, or _id
    const student = await CertificateStudent.findActiveByIdentifier(identifier);

    // If record doesn't exist or is not active
    if (!student || student.isActive !== true) {
      return res.status(404).render('verify', {
        layout: false,
        isValid: false,
        isSearchOnly: false,
        student: null,
        certificateNumber: identifier,
        errorMessage: `No active verified record was found for "${identifier}". The student ID or certificate may be invalid, pending issuance, or deactivated.`,
        pageTitle: 'Student Record Not Verified | Maths Manthra Academy',
        metaDescription: 'Verify student certificates and progress reports issued by Maths Manthra Academy.',
      });
    }

    // Current verification audit timestamp (IST)
    const now = new Date();
    const verificationTime = now.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }) + ' IST';

    // Generate unique verification reference ID
    const hashSeed = `${student._id || ''}-${student.certificateNumber || ''}-${student.studentId || ''}-${now.getTime()}`;
    const refCode = crypto.createHash('sha256').update(hashSeed).digest('hex').substring(0, 10).toUpperCase();
    const verificationId = `MMA-VRF-${refCode}`;

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

    // Format enrollment date
    let formattedEnrollmentDate = formattedIssueDate;
    if (student.createdAt) {
      const d = new Date(student.createdAt);
      if (!isNaN(d.getTime())) {
        formattedEnrollmentDate = d.toLocaleDateString('en-IN', {
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

    // Progress percentage & grade calculation
    let totalScore = 0;
    if (typeof student.totalMark === 'number' && student.totalMark > 0) {
      totalScore = student.totalMark;
    } else if (typeof student.marks === 'number' && student.marks > 0) {
      totalScore = student.marks;
    } else {
      const subTotal = (student.internalMark || 0) + (student.theoryMark || 0) + (student.practicalMark || 0);
      totalScore = subTotal > 0 ? subTotal : (student.totalMark || student.marks || 90);
    }
    const progressPercentage = Math.min(100, Math.max(0, Math.round(totalScore)));

    let grade = 'Grade A';
    if (progressPercentage >= 90) grade = 'Grade A+';
    else if (progressPercentage >= 80) grade = 'Grade A';
    else if (progressPercentage >= 70) grade = 'Grade B+';
    else if (progressPercentage >= 60) grade = 'Grade B';
    else if (progressPercentage >= 50) grade = 'Grade C';
    else grade = 'Pass';

    // Calculate weekly marks average
    const wMarks = [
      student.week1?.weeklyMark,
      student.week2?.weeklyMark,
      student.week3?.weeklyMark,
      student.week4?.weeklyMark,
    ].filter((m) => typeof m === 'number' && !isNaN(m) && m > 0);
    const weeklyAverage = wMarks.length > 0
      ? (wMarks.reduce((a, b) => a + b, 0) / wMarks.length).toFixed(1)
      : (progressPercentage ? progressPercentage.toFixed(1) : '88.5');

    // Verification target for QR code (studentId or certificateNumber)
    const safeCertNumber = student.certificateNumber || student.studentId || identifier;
    const verifyTarget = student.studentId || student.certificateNumber || identifier;
    const verifyUrl = `${req.protocol}://${req.get('host')}/verify/${encodeURIComponent(verifyTarget)}`;
    let qrCodeDataUrl = '';
    let qrCodeSvg = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, {
        margin: 1,
        width: 220,
        color: { dark: '#047857', light: '#ffffff' },
      });
      qrCodeSvg = await QRCode.toString(verifyUrl, {
        type: 'svg',
        margin: 1,
        color: { dark: '#047857', light: '#ffffff' },
      });
    } catch (qrErr) {
      console.warn('QR Code generation error:', qrErr.message);
    }

    // Calculate weekly performance numbers (0-5 scale, max total 40) with migration safety
    const wp = student.weeklyPerformance || {};
    const parseWeeklyScore = (val, legacy) => {
      if (typeof val === 'number' && !isNaN(val)) return Math.min(5, Math.max(0, val));
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const n = parseFloat(val);
        if (!isNaN(n)) return Math.min(5, Math.max(0, n));
      }
      if (typeof legacy === 'number' && !isNaN(legacy)) return Math.min(5, Math.max(0, legacy));
      if (legacy && typeof legacy === 'string') {
        const match = legacy.match(/(\d+(\.\d+)?)/);
        if (match) {
          const n = parseFloat(match[1]);
          if (!isNaN(n)) return Math.min(5, Math.max(0, n));
        }
      }
      return 0;
    };

    const verifiedWeeklyPerformance = {
      week1: {
        assignmentHomework: parseWeeklyScore(wp.week1?.assignmentHomework, student.week1?.assignmentHomework),
        activityEngagement: parseWeeklyScore(wp.week1?.activityEngagement, student.week1?.activityEngagement),
      },
      week2: {
        assignmentHomework: parseWeeklyScore(wp.week2?.assignmentHomework, student.week2?.assignmentHomework),
        activityEngagement: parseWeeklyScore(wp.week2?.activityEngagement, student.week2?.activityEngagement),
      },
      week3: {
        assignmentHomework: parseWeeklyScore(wp.week3?.assignmentHomework, student.week3?.assignmentHomework),
        activityEngagement: parseWeeklyScore(wp.week3?.activityEngagement, student.week3?.activityEngagement),
      },
      week4: {
        assignmentHomework: parseWeeklyScore(wp.week4?.assignmentHomework, student.week4?.assignmentHomework),
        activityEngagement: parseWeeklyScore(wp.week4?.activityEngagement, student.week4?.activityEngagement),
      },
    };

    const week1Total = verifiedWeeklyPerformance.week1.assignmentHomework + verifiedWeeklyPerformance.week1.activityEngagement;
    const week2Total = verifiedWeeklyPerformance.week2.assignmentHomework + verifiedWeeklyPerformance.week2.activityEngagement;
    const week3Total = verifiedWeeklyPerformance.week3.assignmentHomework + verifiedWeeklyPerformance.week3.activityEngagement;
    const week4Total = verifiedWeeklyPerformance.week4.assignmentHomework + verifiedWeeklyPerformance.week4.activityEngagement;
    const weeklyPerformanceTotal = week1Total + week2Total + week3Total + week4Total;

    // Check if progress report data exists
    const hasWeeklyPerformance = Boolean(
      weeklyPerformanceTotal > 0 ||
      [student.week1, student.week2, student.week3, student.week4].some(
        (w) => w && (w.assignmentHomework || w.activityEngagement || (typeof w.weeklyMark === 'number' && w.weeklyMark > 0))
      )
    );
    const hasFinalAssessment = Boolean(
      (typeof student.internalMark === 'number' && student.internalMark > 0) ||
      (typeof student.theoryMark === 'number' && student.theoryMark > 0) ||
      (typeof student.practicalMark === 'number' && student.practicalMark > 0) ||
      (typeof student.totalMark === 'number' && student.totalMark > 0)
    );
    const hasOverallProgress = Boolean(
      (student.academicPerformance && student.academicPerformance.trim()) ||
      (student.assignmentCompletion && student.assignmentCompletion.trim()) ||
      (student.practicalSkills && student.practicalSkills.trim()) ||
      (student.overallProgress && student.overallProgress.trim())
    );
    const hasProgressReport = hasWeeklyPerformance || hasFinalAssessment || hasOverallProgress;

    // Strictly whitelist allowed fields — Read-only public verified page (NO admin controls)
    const safeStudent = {
      fullName: student.fullName || student.name || 'Verified Student',
      email: student.email || '',
      phone: student.phone || '',
      studentId: student.studentId || '',
      certificateNumber: student.certificateNumber || safeCertNumber,
      issueDate: formattedIssueDate,
      enrollmentDate: formattedEnrollmentDate,
      progressPercentage,
      grade,
      weeklyAverage,
      qrCodeDataUrl,
      qrCodeSvg,
      verifyUrl,
      verificationTime,
      verificationId,
      verifiedBy: 'MathsManthra Academy',
      marks: (typeof student.marks === 'number' && !isNaN(student.marks)) ? student.marks : null,
      progressCard: student.progressCard || '',
      profileImage: formattedProfileImage,
      verificationStatus: student.verificationStatus !== false,
      certificateStatus: student.verificationStatus !== false ? 'Active & Verified' : 'Pending Verification',
      courseTitle: (student.courseId && student.courseId.title) ? student.courseId.title : 'Maths Manthra Academy Program',
      // Progress Report Fields
      weeklyPerformance: verifiedWeeklyPerformance,
      week1Total,
      week2Total,
      week3Total,
      week4Total,
      weeklyPerformanceTotal,
      week1: student.week1 || {},
      week2: student.week2 || {},
      week3: student.week3 || {},
      week4: student.week4 || {},
      internalMark: (typeof student.internalMark === 'number' && student.internalMark > 0)
        ? student.internalMark
        : (weeklyPerformanceTotal || 0),
      theoryMark: typeof student.theoryMark === 'number' ? student.theoryMark : 0,
      practicalMark: typeof student.practicalMark === 'number' ? student.practicalMark : 0,
      totalMark: (typeof student.totalMark === 'number' && student.totalMark > 0)
        ? student.totalMark
        : (((typeof student.internalMark === 'number' && student.internalMark > 0 ? student.internalMark : weeklyPerformanceTotal) + (typeof student.theoryMark === 'number' ? student.theoryMark : 0) + (typeof student.practicalMark === 'number' ? student.practicalMark : 0)) || student.totalMark || student.marks || progressPercentage),
      academicPerformance: student.academicPerformance || '',
      assignmentCompletion: student.assignmentCompletion || '',
      practicalSkills: student.practicalSkills || '',
      overallProgress: student.overallProgress || '',
      hasProgressReport,
      hasWeeklyPerformance,
      hasFinalAssessment,
      hasOverallProgress,
      adminEditUrl: null, // Read-only page: strict exclusion of admin controls
    };

    return res.render('verify', {
      layout: false,
      isValid: true,
      isSearchOnly: false,
      student: safeStudent,
      certificateNumber: safeStudent.studentId || safeStudent.certificateNumber,
      errorMessage: null,
      pageTitle: `✓ Verified Student — ${safeStudent.fullName} | Maths Manthra Academy`,
      metaDescription: `Official verified academic student credentials for ${safeStudent.fullName} (${safeStudent.studentId}). Verified by MathsManthra Academy.`,
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
