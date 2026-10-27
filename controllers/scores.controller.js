/**
 * controllers/scores.controller.js
 * Public-facing Student Scores & Evaluation controller.
 * Allows students to check their official marks, evaluation, and academic performance
 * after verifying their registered email via OTP.
 */
const CertificateStudent = require('../models/CertificateStudent');
const Course = require('../models/Course');
const EmailOTP = require('../models/EmailOTP');
const { sendOTPEmail } = require('../services/email.service');
const crypto = require('crypto');

const OTP_SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes session for score checking

function validateScoresOTPGuard(req) {
  if (!req.session.scoresVerifiedEmail && !req.session.certificateVerifiedEmail) {
    return false;
  }

  const verifiedAt = req.session.scoresVerifiedAt || req.session.certificateVerifiedAt;
  if (verifiedAt && (Date.now() - verifiedAt > OTP_SESSION_TIMEOUT)) {
    delete req.session.scoresVerifiedEmail;
    delete req.session.scoresVerifiedAt;
    return false;
  }

  return true;
}

function getVerifiedEmail(req) {
  return req.session.scoresVerifiedEmail || req.session.certificateVerifiedEmail || '';
}

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * GET /scores
 * Public Score Portal — search or lookup student performance records.
 */
exports.showScoresPage = async (req, res, next) => {
  try {
    const { course: courseSlug = '', query = '', msg = '', reverify = '' } = req.query;

    if (reverify === '1') {
      delete req.session.scoresVerifiedEmail;
      delete req.session.scoresVerifiedAt;
      return res.redirect(`/scores${courseSlug ? '?course=' + courseSlug : ''}`);
    }

    // Find all courses with scoresEnabled: true
    const courses = await Course.find({ isActive: true, scoresEnabled: true }).sort({ title: 1 });

    let selectedCourse = null;
    if (courseSlug) {
      selectedCourse = courses.find(c => c.slug === courseSlug) || null;
    }

    const isVerified = validateScoresOTPGuard(req);
    const verifiedEmail = isVerified ? getVerifiedEmail(req) : '';

    let students = [];
    if (isVerified && verifiedEmail) {
      const filter = {
        email: verifiedEmail.toLowerCase().trim(),
        isActive: true,
      };

      if (selectedCourse) {
        filter.courseId = selectedCourse._id;
      }

      students = await CertificateStudent.find(filter)
        .populate('courseId')
        .sort({ createdAt: -1 });

      // Filter out any courses where scoresEnabled is false
      students = students.filter(s => s.courseId && s.courseId.scoresEnabled);
    }

    res.render('course/scores', {
      title: 'Student Scores & Performance Portal — Maths Manthra',
      courses,
      selectedCourse,
      selectedCourseSlug: courseSlug,
      students,
      verifiedEmail,
      otpVerified: isVerified,
      msg,
      layout: false,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /scores/verify
 * Process email lookup once OTP verified.
 */
exports.verifyScoresEmail = async (req, res, next) => {
  try {
    const { email = '', courseSlug = '' } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();

    if (!normalizedEmail) {
      req.flash('error', 'Please enter your email address to check scores.');
      return res.redirect(`/scores${courseSlug ? '?course=' + courseSlug : ''}`);
    }

    if (!validateScoresOTPGuard(req) || getVerifiedEmail(req) !== normalizedEmail) {
      req.flash('error', 'Please verify your email with OTP first (or your session may have expired).');
      return res.redirect(`/scores${courseSlug ? '?course=' + courseSlug : ''}`);
    }

    return res.redirect(`/scores?verified=1${courseSlug ? '&course=' + courseSlug : ''}`);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /scores/send-otp
 * Send a 6-digit OTP to the student's email for scores access.
 */
exports.sendOTP = async (req, res, next) => {
  try {
    const { email = '' } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    // Check if any student record exists for this email with scoresEnabled course
    const studentExists = await CertificateStudent.findOne({
      email: normalizedEmail,
      isActive: true,
    }).populate('courseId');

    if (!studentExists) {
      return res.status(404).json({
        success: false,
        message: 'No student record found with this email. Please check your registered email address.',
      });
    }

    if (studentExists.courseId && !studentExists.courseId.scoresEnabled) {
      return res.status(403).json({
        success: false,
        message: 'Score checking is currently disabled for your enrolled course.',
      });
    }

    // Cooldown 60s
    const existingOTP = await EmailOTP.findOne({
      email: normalizedEmail,
      verified: false,
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
    });

    if (existingOTP) {
      return res.status(429).json({
        success: false,
        message: 'An OTP was sent recently. Please wait 60 seconds before requesting again.',
      });
    }

    await EmailOTP.deleteMany({ email: normalizedEmail, verified: false });

    const otp = generateOTP();
    await EmailOTP.create({ email: normalizedEmail, otp });

    await sendOTPEmail(normalizedEmail, otp);
    req.session.scoresOtpPendingEmail = normalizedEmail;

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully! Please check your email inbox (and spam folder).',
    });
  } catch (err) {
    console.error('[Scores OTP] Send error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again later.',
    });
  }
};

/**
 * POST /scores/verify-otp
 * Verify OTP and grant score access.
 */
exports.verifyOTP = async (req, res, next) => {
  try {
    const { email = '', otp = '' } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();
    const trimmedOTP = (otp || '').trim();

    if (!normalizedEmail || !trimmedOTP) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

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

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await EmailOTP.deleteOne({ _id: otpRecord._id });
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new OTP.',
      });
    }

    otpRecord.attempts += 1;
    await otpRecord.save();

    const storedOtp = otpRecord.otp;
    const isLengthMatch = Buffer.from(trimmedOTP).length === Buffer.from(storedOtp).length;
    const result = isLengthMatch && crypto.timingSafeEqual(
      Buffer.from(trimmedOTP),
      Buffer.from(storedOtp)
    );

    if (!result) {
      const remaining = otpRecord.maxAttempts - otpRecord.attempts;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      });
    }

    otpRecord.verified = true;
    await otpRecord.save();

    req.session.scoresVerifiedEmail = normalizedEmail;
    req.session.scoresVerifiedAt = Date.now();
    req.session.certificateVerifiedEmail = normalizedEmail;
    req.session.certificateVerifiedAt = Date.now();

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully! Loading your academic performance report...',
    });
  } catch (err) {
    console.error('[Scores OTP] Verify error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify OTP. Please try again.',
    });
  }
};
