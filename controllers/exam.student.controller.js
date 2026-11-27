/**
 * controllers/exam.student.controller.js
 * Student Examination Portal Controller:
 * - Student OTP login, resend, verification with multi-record resolution
 * - Exam listing with server-calculated eligibility
 * - Exam instructions page
 * - Exam runner initialization & secure question snapshot serving
 * - Autosave with server timestamp validation & conflict prevention
 * - Server-controlled countdown & automatic deadline enforcement
 * - Submission & grading evaluation
 * - Student result status presentation
 */
const crypto = require('crypto');
const CertificateStudent = require('../models/CertificateStudent');
const Examination = require('../models/Examination');
const QuestionBank = require('../models/QuestionBank');
const ExamAttempt = require('../models/ExamAttempt');
const ExamResponse = require('../models/ExamResponse');
const ExamResult = require('../models/ExamResult');
const EmailOTP = require('../models/EmailOTP');
const emailService = require('../services/email.service');
const { evaluateResponse } = require('../utils/scoring');

/**
 * Safe redirect helper for serverless / Vercel environments.
 * Awaits session persistence before responding with HTTP 303 See Other
 * to force the client to make a GET request and prevent redirected POST loops or 404s.
 * Propagates session persistence errors to express error handler.
 */
function safeRedirect(req, res, targetUrl, next) {
  if (res.headersSent) {
    return;
  }
  const errorHandler = typeof next === 'function' ? next : (typeof req.next === 'function' ? req.next : null);
  if (req.session && typeof req.session.save === 'function') {
    return req.session.save((err) => {
      if (err) {
        console.error('Session save error during safeRedirect:', err.message);
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
 * Helper: Generate 6-digit numeric OTP
 */
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Helper: Mask email for security
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.trim().split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

/**
 * Helper: Calculate eligibility of a student for an examination on server
 */
async function calculateExamEligibility(exam, studentId) {
  const now = new Date();

  // 1. Exam status must be published
  if (exam.status !== 'published') {
    return { eligible: false, reason: 'Examination is not published or active.', statusTag: 'closed' };
  }

  // 2. Availability window check
  if (exam.availabilityMode === 'scheduled') {
    if (exam.startAt && now < new Date(exam.startAt)) {
      return { eligible: false, reason: 'Examination has not started yet.', statusTag: 'upcoming' };
    }
    if (exam.endAt && now > new Date(exam.endAt)) {
      return { eligible: false, reason: 'Examination schedule has closed.', statusTag: 'closed' };
    }
  }

  // 3. Course eligibility check (if courseId is assigned)
  if (exam.courseId) {
    const student = await CertificateStudent.findById(studentId).populate('courseId');
    if (!student || !student.courseId || String(student.courseId._id) !== String(exam.courseId._id || exam.courseId)) {
      return {
        eligible: false,
        reason: 'This examination is restricted to students enrolled in the designated course.',
        statusTag: 'restricted',
      };
    }
  }

  // 4. Attempt history check
  const attempts = await ExamAttempt.find({
    examinationId: exam._id,
    studentId,
  }).sort({ attemptNumber: 1 });

  const totalAttempts = attempts.length;
  const maxAttempts = exam.maxAttempts || 3;
  const inProgressAttempt = attempts.find((a) => a.status === 'in_progress');

  if (inProgressAttempt) {
    // If expired, it needs finalization
    if (new Date() > new Date(inProgressAttempt.expiresAt)) {
      return {
        eligible: false,
        activeAttemptId: inProgressAttempt._id,
        requiresFinalization: true,
        reason: 'You have an expired attempt awaiting finalization.',
        statusTag: 'in_progress',
        attemptsCount: totalAttempts,
        remainingAttempts: Math.max(0, maxAttempts - totalAttempts),
      };
    }

    return {
      eligible: true,
      hasActiveAttempt: true,
      activeAttemptId: inProgressAttempt._id,
      reason: 'You have an active attempt in progress.',
      statusTag: 'in_progress',
      attemptsCount: totalAttempts,
      remainingAttempts: Math.max(0, maxAttempts - totalAttempts),
    };
  }

  if (totalAttempts >= maxAttempts) {
    return {
      eligible: false,
      reason: `Maximum attempt limit (${maxAttempts}) reached.`,
      statusTag: 'completed',
      attemptsCount: totalAttempts,
      remainingAttempts: 0,
    };
  }

  return {
    eligible: true,
    hasActiveAttempt: false,
    reason: 'Available for attempt.',
    statusTag: 'available',
    attemptsCount: totalAttempts,
    remainingAttempts: maxAttempts - totalAttempts,
  };
}

// ─── SHAREABLE PUBLIC EXAMINATION ACCESS ───────────────────────────────────────

/**
 * GET /exam/:publicToken
 * Public entrypoint for a shareable examination link.
 * Verifies publicToken existence, enforces published status, and routes student.
 */
exports.showPublicExam = async (req, res) => {
  try {
    const { publicToken } = req.params;
    if (!publicToken || typeof publicToken !== 'string') {
      req.flash('error', 'Invalid examination link.');
      return res.redirect('/exams/login');
    }

    const exam = await Examination.findOne({ publicToken: publicToken.trim() })
      .populate('courseId', 'title slug');

    if (!exam) {
      req.flash('error', 'Examination link not found or has been removed.');
      return res.redirect('/exams/login');
    }

    // Strict publication status check: Only published exams allow new student access
    if (exam.status !== 'published') {
      const statusNotice = exam.status === 'draft'
        ? 'This examination is currently in draft mode and is not open to students.'
        : exam.status === 'closed'
          ? 'This examination has been concluded and is no longer accepting new attempts.'
          : 'This examination has been archived.';
      return res.render('exams/notice', {
        layout: 'layouts/main',
        title: `${exam.title} — Not Available | Maths Manthra`,
        exam,
        notice: statusNotice,
        badgeType: exam.status === 'draft' ? 'secondary' : 'danger',
      });
    }

    // Set return URL to this exam's instructions / portal entry
    if (req.session) {
      req.session.examReturnTo = `/exams/${exam.slug}`;
      req.session.targetExamId = exam._id.toString();
      req.session.targetExamTitle = exam.title;
    }

    // If student is already verified in session, take them directly to instructions
    if (req.session && req.session.examStudent && req.session.examStudent.studentId) {
      return res.redirect(`/exams/${exam.slug}`);
    }

    // Otherwise render examination welcome & OTP authentication landing page
    const questionsCount = exam.questionSelectionMode === 'manual'
      ? (exam.selectedQuestions ? exam.selectedQuestions.length : 0)
      : (exam.randomSelectionRules ? exam.randomSelectionRules.reduce((acc, r) => acc + (r.count || 0), 0) : 0);

    res.render('exams/public_landing', {
      layout: 'layouts/main',
      title: `${exam.title} — Assessment | Maths Manthra`,
      exam,
      questionsCount,
      email: req.session?.examLoginEmail || '',
      step: req.session?.examLoginStep || 'email',
      studentsList: req.session?.examCandidateStudents || [],
    });
  } catch (err) {
    console.error('showPublicExam error:', err);
    req.flash('error', 'Error opening examination.');
    return res.redirect('/exams/login');
  }
};

// ─── AUTHENTICATION CONTROLLER ──────────────────────────────────────────────────

/**
 * GET /exams/login
 */
exports.showLogin = (req, res) => {
  if (req.session && req.session.examStudent && req.session.examStudent.studentId) {
    return res.redirect('/exams');
  }

  res.render('exams/login', {
    layout: 'layouts/main',
    title: 'Student Exam Portal Login | Maths Manthra',
    email: req.session.examLoginEmail || '',
    step: req.session.examLoginStep || 'email', // 'email' | 'record_selection' | 'otp'
    studentsList: req.session.examCandidateStudents || [],
  });
};

/**
 * POST /exams/send-otp
 * Step 1: Receives registered email, validates students in database.
 * If multiple students match, requires record selection before sending OTP.
 */
exports.sendOTP = async (req, res, next) => {
  try {
    const rawEmail = (req.body.email || '').trim().toLowerCase();
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
      }
      req.flash('error', 'Please enter a valid email address.');
      return safeRedirect(req, res, '/exams/login', next);
    }

    // Find all active students with this email
    const matchingStudents = await CertificateStudent.find({
      email: rawEmail,
      isActive: true,
    }).populate('courseId', 'title slug');

    if (!matchingStudents || matchingStudents.length === 0) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({
          success: false,
          message: 'No registered student record found for this email. Please check your credentials.',
        });
      }
      req.flash('error', 'No registered student record found for this email. Please check your credentials.');
      return safeRedirect(req, res, '/exams/login', next);
    }

    // Check for cooldown on recent OTP
    const recentOTP = await EmailOTP.findOne({
      email: rawEmail,
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
    });

    if (recentOTP) {
      const remainingSeconds = Math.max(1, Math.ceil((recentOTP.createdAt.getTime() + 60000 - Date.now()) / 1000));
      const waitMsg = `Please wait ${remainingSeconds} seconds before requesting another OTP.`;
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(429).json({ success: false, message: waitMsg, cooldownSeconds: remainingSeconds });
      }
      req.flash('error', waitMsg);
      return safeRedirect(req, res, '/exams/login', next);
    }

    // If multiple students match and studentId was not specified in body
    const selectedStudentId = (req.body.studentId || '').trim();
    if (matchingStudents.length > 1 && !selectedStudentId) {
      req.session.examLoginEmail = rawEmail;
      req.session.examLoginStep = 'record_selection';
      req.session.examCandidateStudents = matchingStudents.map((s) => ({
        id: s._id.toString(),
        fullName: s.fullName || s.name,
        studentId: s.studentId || s.certificateNumber || 'ID N/A',
        courseTitle: s.courseId?.title || 'Course Enrollment',
      }));

      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.json({
          success: true,
          requiresSelection: true,
          students: req.session.examCandidateStudents,
          message: 'Multiple records found. Please select your student profile to proceed.',
        });
      }
      return safeRedirect(req, res, '/exams/login', next);
    }

    // If studentId was supplied or only 1 match
    let studentRecord = null;
    if (selectedStudentId) {
      studentRecord = matchingStudents.find((s) => s._id.toString() === selectedStudentId);
      if (!studentRecord) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(400).json({ success: false, message: 'Invalid student profile selected.' });
        }
        req.flash('error', 'Invalid student profile selected.');
        return safeRedirect(req, res, '/exams/login', next);
      }
    } else {
      studentRecord = matchingStudents[0];
    }

    // Generate and persist OTP
    const otp = generateOTP();
    await EmailOTP.deleteMany({ email: rawEmail, verified: false });
    await EmailOTP.create({ email: rawEmail, otp });

    // Development-only terminal OTP logging
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `\n[MATHS MANTHRA EXAM OTP]\nEmail: ${maskEmail(rawEmail)}\nOTP: ${otp}\nExpires: 10 minutes\n`
      );
    }

    // Send OTP email (or mock/log in test environment)
    const studentDisplayName = studentRecord.fullName || studentRecord.name || 'Student';
    let emailSuccess = true;

    if (process.env.NODE_ENV !== 'test') {
      try {
        await emailService.sendOTPEmail(rawEmail, otp, studentDisplayName);
      } catch (sendErr) {
        console.error('[Exam OTP] Email delivery failure:', sendErr.message);
        emailSuccess = false;
      }
    } else {
      console.log(`[Exam OTP Test Mock] Generated OTP ${otp} for ${rawEmail}`);
    }

    if (!emailSuccess) {
      await EmailOTP.deleteMany({ email: rawEmail, otp });
      const failMsg = 'Failed to deliver OTP email. Please verify SMTP configuration or try again shortly.';
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(500).json({ success: false, message: failMsg });
      }
      req.flash('error', failMsg);
      return safeRedirect(req, res, '/exams/login', next);
    }

    // Store in session for verification step
    req.session.examLoginEmail = rawEmail;
    req.session.examTargetStudentId = studentRecord._id.toString();
    req.session.examLoginStep = 'otp';

    const okMsg = `Verification code sent to ${maskEmail(rawEmail)}. Valid for 10 minutes.`;
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: okMsg });
    }
    req.flash('success', okMsg);
    return safeRedirect(req, res, '/exams/login', next);
  } catch (err) {
    console.error('sendOTP error:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ success: false, message: 'Server error processing OTP request.' });
    }
    req.flash('error', 'Server error processing OTP request. Please try again.');
    return safeRedirect(req, res, '/exams/login', next);
  }
};

/**
 * POST /exams/verify-otp
 * Step 2: Validates OTP and creates student examination session
 */
exports.verifyOTP = async (req, res, next) => {
  try {
    const rawEmail = (req.body.email || req.session.examLoginEmail || '').trim().toLowerCase();
    const rawOtp = (req.body.otp || '').trim();
    const studentId = req.session.examTargetStudentId || (req.body.studentId || '').trim();

    if (!rawEmail || !rawOtp) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
      }
      req.flash('error', 'Email and OTP are required.');
      return safeRedirect(req, res, '/exams/login', next);
    }

    const otpRecord = await EmailOTP.findOne({ email: rawEmail, verified: false }).sort({ createdAt: -1 });
    if (!otpRecord) {
      const expiredMsg = 'OTP has expired or is invalid. Please request a new code.';
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message: expiredMsg });
      }
      req.flash('error', expiredMsg);
      return safeRedirect(req, res, '/exams/login', next);
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await EmailOTP.deleteOne({ _id: otpRecord._id });
      const lockoutMsg = 'Too many failed attempts. Please request a new verification code.';
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(429).json({ success: false, message: lockoutMsg });
      }
      req.flash('error', lockoutMsg);
      return safeRedirect(req, res, '/exams/login', next);
    }

    if (otpRecord.otp !== rawOtp) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      const remain = otpRecord.maxAttempts - otpRecord.attempts;
      const invalidMsg = `Invalid OTP. ${remain} attempt(s) remaining.`;
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message: invalidMsg });
      }
      req.flash('error', invalidMsg);
      return safeRedirect(req, res, '/exams/login', next);
    }

    // OTP Valid! Delete OTP record
    await EmailOTP.deleteOne({ _id: otpRecord._id });

    // Verify student document exists
    const student = await CertificateStudent.findById(studentId).populate('courseId', 'title slug');
    if (!student || !student.isActive) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ success: false, message: 'Student profile not active or found.' });
      }
      req.flash('error', 'Student profile not active or found.');
      return safeRedirect(req, res, '/exams/login', next);
    }

    // Establish student exam session
    req.session.examStudent = {
      studentId: student._id.toString(),
      fullName: student.fullName || student.name,
      email: student.email,
      phone: student.phone || '',
      officialStudentId: student.studentId || student.certificateNumber || '',
      courseId: student.courseId ? student.courseId._id.toString() : null,
      courseTitle: student.courseId ? student.courseId.title : 'General',
      loginTime: new Date().toISOString(),
    };

    // Clean login flow temporary keys
    delete req.session.examLoginEmail;
    delete req.session.examLoginStep;
    delete req.session.examCandidateStudents;
    delete req.session.examTargetStudentId;

    const returnUrl = req.session.examReturnTo || '/exams';
    delete req.session.examReturnTo;

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, redirectUrl: returnUrl });
    }
    req.flash('success', `Welcome, ${student.fullName || student.name}! Examination access verified.`);
    return safeRedirect(req, res, returnUrl, next);
  } catch (err) {
    console.error('verifyOTP error:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ success: false, message: 'Internal error verifying OTP.' });
    }
    req.flash('error', 'Internal error verifying OTP.');
    return safeRedirect(req, res, '/exams/login', next);
  }
};

/**
 * POST /exams/logout
 */
exports.logout = (req, res) => {
  if (req.session) {
    delete req.session.examStudent;
  }
  req.flash('success', 'You have been logged out of the examination portal.');
  return res.redirect('/exams/login');
};

// ─── EXAMINATION LISTING & PORTAL ───────────────────────────────────────────────

/**
 * GET /exams
 * Student examination dashboard and catalog
 */
exports.listExams = async (req, res) => {
  try {
    const studentSession = req.session.examStudent;
    const student = await CertificateStudent.findById(studentSession.studentId).populate('courseId');

    // Retrieve all published or closed examinations
    const examinations = await Examination.find({
      status: { $in: ['published', 'closed'] },
    }).populate('courseId', 'title slug').sort({ createdAt: -1 });

    const examCards = [];
    for (const exam of examinations) {
      const eligibility = await calculateExamEligibility(exam, student._id);
      examCards.push({
        exam,
        eligibility,
      });
    }

    // Retrieve previous student attempts and results for history overview
    const studentAttempts = await ExamAttempt.find({
      studentId: student._id,
    }).populate('examinationId', 'title slug totalMarks passingMarks durationMinutes')
      .sort({ createdAt: -1 });

    const studentResults = await ExamResult.find({
      studentId: student._id,
    }).populate('examinationId', 'title slug')
      .sort({ createdAt: -1 });

    res.render('exams/index', {
      layout: 'layouts/main',
      title: 'Examinations Portal | Maths Manthra',
      student,
      examCards,
      studentAttempts,
      studentResults,
    });
  } catch (err) {
    console.error('listExams error:', err);
    req.flash('error', 'Failed to load examinations. Please try again.');
    return res.redirect('/exams/login');
  }
};

/**
 * GET /exams/:slug
 * Dedicated pre-exam instructions page
 */
exports.showInstructions = async (req, res) => {
  try {
    const { slug } = req.params;
    const studentSession = req.session.examStudent;

    const exam = await Examination.findOne({ slug }).populate('courseId', 'title slug');
    if (!exam) {
      req.flash('error', 'Examination not found.');
      return res.redirect('/exams');
    }

    let eligibility = await calculateExamEligibility(exam, studentSession.studentId);
    if (eligibility.requiresFinalization && eligibility.activeAttemptId) {
      await finalizeAttempt(eligibility.activeAttemptId, 'expired');
      eligibility = await calculateExamEligibility(exam, studentSession.studentId);
    }

    const questionsCount = exam.questionSelectionMode === 'manual'
      ? (exam.selectedQuestions ? exam.selectedQuestions.length : 0)
      : (exam.randomSelectionRules ? exam.randomSelectionRules.reduce((acc, r) => acc + (r.count || 0), 0) : 0);

    // If student already has an active in_progress attempt for this exam, resume directly
    if (eligibility.hasActiveAttempt && eligibility.activeAttemptId) {
      return res.redirect(`/exams/${exam.slug}/runner`);
    }

    res.render('exams/instructions', {
      layout: 'layouts/main',
      title: `${exam.title} — Instructions | Maths Manthra`,
      exam,
      eligibility,
      questionsCount,
      student: studentSession,
    });
  } catch (err) {
    console.error('showInstructions error:', err);
    req.flash('error', 'Error loading examination instructions.');
    return res.redirect('/exams');
  }
};

// ─── EXAMINATION ATTEMPT ALLOCATION & RUNNER ──────────────────────────────────

/**
 * POST /exams/:id/start
 * Server-side atomic attempt allocation with concurrency and eligibility guards
 */
exports.startAttempt = async (req, res) => {
  try {
    const examId = req.params.id;
    const studentId = req.session.examStudent.studentId;

    const exam = await Examination.findById(examId);
    if (!exam) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ success: false, message: 'Examination not found.' });
      }
      req.flash('error', 'Examination not found.');
      return res.redirect('/exams');
    }

    // Check server eligibility
    let eligibility = await calculateExamEligibility(exam, studentId);

    // If an expired attempt exists that requires finalization, finalize it now
    if (eligibility.requiresFinalization && eligibility.activeAttemptId) {
      await finalizeAttempt(eligibility.activeAttemptId, 'expired');
      eligibility = await calculateExamEligibility(exam, studentId);
    }

    // If an active attempt already exists and is valid, resume it
    if (eligibility.hasActiveAttempt && eligibility.activeAttemptId) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.json({
          success: true,
          message: 'Resuming active attempt.',
          redirectUrl: `/exams/${exam.slug}/runner`,
        });
      }
      return res.redirect(`/exams/${exam.slug}/runner`);
    }

    if (!eligibility.eligible) {
      const deniedMsg = eligibility.reason || 'You are not eligible to start this examination.';
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ success: false, message: deniedMsg });
      }
      req.flash('error', deniedMsg);
      return res.redirect(`/exams/${exam.slug}`);
    }

    // Determine questions to snapshot
    let questionsToSnapshot = [];
    if (exam.questionSelectionMode === 'manual') {
      questionsToSnapshot = await QuestionBank.find({
        _id: { $in: exam.selectedQuestions },
        status: { $ne: 'archived' },
      });
    } else {
      // Random category rules
      for (const rule of exam.randomSelectionRules) {
        const query = { status: { $ne: 'archived' }, category: rule.category };
        if (rule.topic) query.topic = rule.topic;
        if (rule.difficulty && rule.difficulty !== 'any') query.difficulty = rule.difficulty;

        const picked = await QuestionBank.aggregate([
          { $match: query },
          { $sample: { size: rule.count || 1 } },
        ]);
        questionsToSnapshot.push(...picked);
      }
    }

    if (!questionsToSnapshot || questionsToSnapshot.length === 0) {
      const noQMsg = 'Examination question paper is not ready. Please contact administrator.';
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message: noQMsg });
      }
      req.flash('error', noQMsg);
      return res.redirect(`/exams/${exam.slug}`);
    }

    // Randomize question sequence if configured
    if (exam.randomizeQuestions) {
      questionsToSnapshot = questionsToSnapshot.sort(() => Math.random() - 0.5);
    }

    // Build question snapshot with private answer keys safely locked on server
    const snapshotItems = questionsToSnapshot.map((q) => {
      let optionsList = (q.options || []).map((o) => ({
        optionId: o.optionId,
        text: o.text,
        image: o.image || '',
      }));

      // Option randomization if configured
      if (exam.randomizeOptions && (q.questionType === 'single_choice' || q.questionType === 'multiple_choice')) {
        optionsList = optionsList.sort(() => Math.random() - 0.5);
      }

      return {
        questionId: q._id,
        questionText: q.questionText,
        questionType: q.questionType,
        options: optionsList,
        marks: q.marks || 1,
        negativeMarks: q.negativeMarks || 0,
        privateAnswerKeys: {
          correctAnswers: q.correctAnswers || [],
          acceptedAnswers: q.acceptedAnswers || [],
          caseSensitive: Boolean(q.caseSensitive),
          explanation: q.explanation || '',
        },
      };
    });

    const now = new Date();
    const durationMs = (exam.durationMinutes || 60) * 60 * 1000;
    let expiresAt = new Date(now.getTime() + durationMs);

    // If scheduled with an endAt that is earlier than now + duration, cap expiration at endAt
    if (exam.availabilityMode === 'scheduled' && exam.endAt && new Date(exam.endAt) < expiresAt) {
      expiresAt = new Date(exam.endAt);
    }

    const currentAttemptCount = eligibility.attemptsCount || 0;
    const newAttemptNumber = currentAttemptCount + 1;

    // Create attempt with atomic partial unique lock on { examinationId: 1, activeAttemptLock: 1 }
    let attempt;
    try {
      attempt = await ExamAttempt.create({
        examinationId: exam._id,
        studentId,
        attemptNumber: newAttemptNumber,
        activeAttemptLock: studentId,
        status: 'in_progress',
        startedAt: now,
        expiresAt,
        examVersion: exam.version || 1,
        questionSnapshot: snapshotItems,
      });

      // Mark exam as locked on first attempt
      if (!exam.isLocked) {
        exam.isLocked = true;
        await exam.save();
      }
    } catch (createErr) {
      // Catch MongoDB duplicate key error code 11000
      if (createErr.code === 11000) {
        // Find existing in_progress attempt
        const existing = await ExamAttempt.findOne({
          examinationId: exam._id,
          studentId,
          status: 'in_progress',
        });
        if (existing) {
          if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({
              success: true,
              message: 'Attempt already in progress. Resuming.',
              redirectUrl: `/exams/${exam.slug}/runner`,
            });
          }
          return res.redirect(`/exams/${exam.slug}/runner`);
        }
      }
      throw createErr;
    }

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        message: 'Examination started.',
        redirectUrl: `/exams/${exam.slug}/runner`,
      });
    }
    return res.redirect(`/exams/${exam.slug}/runner`);
  } catch (err) {
    console.error('startAttempt error:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ success: false, message: 'Could not allocate examination attempt.' });
    }
    req.flash('error', 'Could not allocate examination attempt.');
    return res.redirect('/exams');
  }
};

/**
 * GET /exams/:slug/runner
 * The responsive student examination runner interface
 */
exports.showRunner = async (req, res) => {
  try {
    const { slug } = req.params;
    const studentId = req.session.examStudent.studentId;

    const exam = await Examination.findOne({ slug });
    if (!exam) {
      req.flash('error', 'Examination not found.');
      return res.redirect('/exams');
    }

    const attempt = await ExamAttempt.findOne({
      examinationId: exam._id,
      studentId,
      status: 'in_progress',
    });

    if (!attempt) {
      req.flash('error', 'No active attempt found. Please view examination details.');
      return res.redirect(`/exams/${exam.slug}`);
    }

    // Check server deadline expiration
    const now = new Date();
    if (now > new Date(attempt.expiresAt)) {
      // Auto-finalize expired attempt immediately
      await finalizeAttempt(attempt._id, 'expired');
      req.flash('info', 'Time expired! Your examination was automatically submitted.');
      return res.redirect(`/exams/${exam.slug}/result/${attempt._id}`);
    }

    // Fetch previously saved responses for recovery
    const savedResponses = await ExamResponse.find({
      attemptId: attempt._id,
    });

    const responseMap = {};
    for (const resp of savedResponses) {
      responseMap[resp.snapshotQuestionId.toString()] = {
        studentAnswer: resp.studentAnswer,
        isMarkedForReview: resp.isMarkedForReview,
        isAnswered: resp.isAnswered,
      };
    }

    // Sanitized questions (NEVER expose privateAnswerKeys!)
    const sanitizedQuestions = attempt.getSanitizedQuestions();

    const remainingSeconds = Math.max(0, Math.floor((new Date(attempt.expiresAt).getTime() - now.getTime()) / 1000));

    res.render('exams/runner', {
      layout: false, // Self-contained full-screen exam runner layout
      title: `${exam.title} — Active Examination | Maths Manthra`,
      exam,
      attempt,
      questions: sanitizedQuestions,
      savedResponses: responseMap,
      remainingSeconds,
      serverTime: now.toISOString(),
      expiresAt: attempt.expiresAt.toISOString(),
      student: req.session.examStudent,
    });
  } catch (err) {
    console.error('showRunner error:', err);
    req.flash('error', 'Error opening examination interface.');
    return res.redirect('/exams');
  }
};

/**
 * POST /exams/attempt/:attemptId/save-answer
 * Autosave endpoint with server timestamp, question ownership, and deadline checks
 */
exports.saveAnswer = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const studentId = req.session.examStudent.studentId;
    const { snapshotQuestionId, answer, isMarkedForReview, clientTimestamp } = req.body;

    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      studentId,
      status: 'in_progress',
    });

    if (!attempt) {
      return res.status(403).json({
        success: false,
        isExpired: true,
        message: 'Active attempt not found or already submitted.',
      });
    }

    // Server-enforced deadline check
    const now = new Date();
    if (now > new Date(attempt.expiresAt)) {
      await finalizeAttempt(attempt._id, 'expired');
      return res.status(403).json({
        success: false,
        isExpired: true,
        message: 'Examination time has expired. Attempt has been finalized.',
        redirectUrl: `/exams/results/${attempt._id}`,
      });
    }

    // Validate that snapshotQuestionId exists in this attempt's snapshot
    const questionSnapshot = attempt.questionSnapshot.id(snapshotQuestionId);
    if (!questionSnapshot) {
      return res.status(400).json({
        success: false,
        message: 'Question does not belong to this examination attempt.',
      });
    }

    const hasAnswer = answer !== null && answer !== undefined && (
      (typeof answer === 'string' && answer.trim().length > 0) ||
      (Array.isArray(answer) && answer.length > 0)
    );

    // Stale check protection: prevent older client request from overwriting newer response
    const existingResponse = await ExamResponse.findOne({
      attemptId: attempt._id,
      snapshotQuestionId,
    });

    if (existingResponse && clientTimestamp) {
      const clientTime = new Date(clientTimestamp);
      if (!isNaN(clientTime.getTime()) && clientTime < existingResponse.lastSavedAt) {
        // Ignore stale payload, return current saved state
        return res.json({
          success: true,
          ignoredStale: true,
          savedAt: existingResponse.lastSavedAt,
          isAnswered: existingResponse.isAnswered,
        });
      }
    }

    // Upsert response
    const updatedResponse = await ExamResponse.findOneAndUpdate(
      { attemptId: attempt._id, snapshotQuestionId },
      {
        $set: {
          examinationId: attempt.examinationId,
          studentId: attempt.studentId,
          originalQuestionId: questionSnapshot.questionId,
          studentAnswer: answer,
          isMarkedForReview: Boolean(isMarkedForReview),
          isAnswered: Boolean(hasAnswer),
          maxMarks: questionSnapshot.marks || 1,
          lastSavedAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Update attempt's lastActivityAt timestamp
    attempt.lastActivityAt = now;
    await attempt.save();

    return res.json({
      success: true,
      savedAt: updatedResponse.lastSavedAt,
      isAnswered: updatedResponse.isAnswered,
      isMarkedForReview: updatedResponse.isMarkedForReview,
      remainingSeconds: Math.max(0, Math.floor((new Date(attempt.expiresAt).getTime() - now.getTime()) / 1000)),
    });
  } catch (err) {
    console.error('saveAnswer error:', err);
    return res.status(500).json({ success: false, message: 'Failed to persist answer.' });
  }
};

/**
 * POST /exams/attempt/:attemptId/submit
 * Final manual submission of attempt
 */
exports.submitAttempt = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const studentId = req.session.examStudent.studentId;

    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      studentId,
      status: 'in_progress',
    });

    if (!attempt) {
      // Check if attempt was already finalized (e.g. by auto-expiry or earlier submit)
      const finalizedResult = await ExamResult.findOne({ attemptId });
      if (finalizedResult) {
        const redirectUrl = `/exams/results/${attemptId}`;
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.json({
            success: true,
            message: 'Examination already submitted.',
            redirectUrl,
          });
        }
        return res.redirect(redirectUrl);
      }
      return res.status(404).json({
        success: false,
        message: 'No in-progress attempt found to submit.',
      });
    }

    // Server-enforced deadline check
    const now = new Date();
    const finalStatus = (now > new Date(attempt.expiresAt)) ? 'expired' : 'submitted';
    const result = await finalizeAttempt(attempt._id, finalStatus);

    const redirectUrl = `/exams/results/${attempt._id}`;
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        message: 'Examination successfully submitted.',
        redirectUrl,
      });
    }

    req.flash('success', 'Examination successfully submitted!');
    return res.redirect(redirectUrl);
  } catch (err) {
    console.error('submitAttempt error:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ success: false, message: 'Error processing examination submission.' });
    }
    req.flash('error', 'Error processing examination submission.');
    return res.redirect('/exams');
  }
};

/**
 * Core Helper: Finalize Attempt & Grade Objective Questions
 */
async function finalizeAttempt(attemptId, finalStatus = 'submitted') {
  const attempt = await ExamAttempt.findById(attemptId);
  if (!attempt || attempt.status !== 'in_progress') {
    return await ExamResult.findOne({ attemptId });
  }

  const now = new Date();

  // 1. Release activeAttemptLock and mark status
  attempt.status = finalStatus;
  attempt.submittedAt = now;
  attempt.activeAttemptLock = undefined; // $unset active lock
  await attempt.save();

  // 2. Fetch all snapshot questions and responses
  const responses = await ExamResponse.find({ attemptId: attempt._id });
  const responseBySnapshotId = new Map();
  for (const resp of responses) {
    responseBySnapshotId.set(resp.snapshotQuestionId.toString(), resp);
  }

  let totalAvailableMarks = 0;
  let obtainedMarks = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  let pendingManualCount = 0;

  for (const question of attempt.questionSnapshot) {
    totalAvailableMarks += (question.marks || 1);
    const resp = responseBySnapshotId.get(question._id.toString());
    const studentAnswer = resp ? resp.studentAnswer : null;

    // Run scoring evaluation
    const evalResult = evaluateResponse(question, studentAnswer);

    if (evalResult.evaluationStatus === 'unanswered') {
      unansweredCount += 1;
    } else if (evalResult.evaluationStatus === 'pending_manual') {
      pendingManualCount += 1;
    } else if (evalResult.isCorrect === true) {
      correctCount += 1;
      obtainedMarks += evalResult.awardedMarks;
    } else {
      incorrectCount += 1;
      obtainedMarks += evalResult.awardedMarks; // accommodates negative marks if any
    }

    // Persist evaluation per response record
    if (resp) {
      resp.evaluationStatus = evalResult.evaluationStatus;
      resp.isCorrect = evalResult.isCorrect;
      resp.awardedMarks = evalResult.awardedMarks;
      await resp.save();
    } else {
      // Create empty response record for unanswered question
      await ExamResponse.create({
        attemptId: attempt._id,
        examinationId: attempt.examinationId,
        studentId: attempt.studentId,
        snapshotQuestionId: question._id,
        originalQuestionId: question.questionId,
        studentAnswer: null,
        isAnswered: false,
        evaluationStatus: 'unanswered',
        isCorrect: false,
        maxMarks: question.marks || 1,
        awardedMarks: 0,
      });
    }
  }

  // Calculate percentage and pass status
  const exam = await Examination.findById(attempt.examinationId);
  const passingMarks = exam ? (exam.passingMarks || 40) : 40;
  const percentage = totalAvailableMarks > 0
    ? Math.max(0, Math.round((obtainedMarks / totalAvailableMarks) * 1000) / 10)
    : 0;

  const isPassed = pendingManualCount === 0 && obtainedMarks >= passingMarks;
  const resultStatus = pendingManualCount > 0 ? 'pending_evaluation' : 'finalized';

  // 3. Upsert ExamResult record
  const examResult = await ExamResult.findOneAndUpdate(
    { attemptId: attempt._id },
    {
      $set: {
        examinationId: attempt.examinationId,
        studentId: attempt.studentId,
        attemptNumber: attempt.attemptNumber,
        totalAvailableMarks,
        obtainedMarks: Math.max(0, obtainedMarks),
        percentage,
        correctCount,
        incorrectCount,
        unansweredCount,
        pendingManualCount,
        isPassed,
        resultStatus,
        finalizedAt: resultStatus === 'finalized' ? now : null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return examResult;
}

// ─── STUDENT RESULT STATUS ──────────────────────────────────────────────────────

/**
 * GET /exams/results/:attemptId
 * Displays student score, performance summary, and evaluation status
 */
exports.showResult = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const studentId = req.session.examStudent.studentId;

    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      studentId,
    }).populate('examinationId');

    if (!attempt) {
      req.flash('error', 'Attempt result not found or access unauthorized.');
      return res.redirect('/exams');
    }

    const exam = attempt.examinationId;
    const result = await ExamResult.findOne({ attemptId: attempt._id });
    const responses = await ExamResponse.find({ attemptId: attempt._id });

    // Check examination result-release settings
    const canShowScores = exam.showResultsImmediately || (result && result.resultStatus === 'finalized');
    const canShowAnswers = exam.showCorrectAnswersAfterEvaluation && result && result.resultStatus === 'finalized';

    res.render('exams/result', {
      layout: 'layouts/main',
      title: `${exam.title} — Result | Maths Manthra`,
      exam,
      attempt,
      result,
      responses,
      canShowScores,
      canShowAnswers,
      student: req.session.examStudent,
    });
  } catch (err) {
    console.error('showResult error:', err);
    req.flash('error', 'Error retrieving examination result.');
    return res.redirect('/exams');
  }
};
