/**
 * routes/exam.routes.js
 * Student Examination Portal routes:
 * - Authentication (OTP login, send, verify, logout)
 * - Exam catalog & eligibility dashboard
 * - Instructions page
 * - Attempt allocation & active runner
 * - Autosave & server deadline validation
 * - Submission & result view
 */
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const examStudentCtrl = require('../controllers/exam.student.controller');
const { requireExamStudent } = require('../middleware/exam.auth.middleware');

// ── Rate Limiters ─────────────────────────────────────────────────────────────
const examAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const examSaveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // allows frequent debounce autosaves while defending against DOS
  message: { success: false, message: 'Rate limit exceeded for autosave. Slowing down.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

// ── Authentication Routes ─────────────────────────────────────────────────────
router.get('/login', examStudentCtrl.showLogin);
router.post('/send-otp', examAuthLimiter, examStudentCtrl.sendOTP);
router.post('/verify-otp', examAuthLimiter, examStudentCtrl.verifyOTP);
router.post('/logout', examStudentCtrl.logout);

// ── Protected Student Portal Routes ───────────────────────────────────────────
router.get('/', requireExamStudent, examStudentCtrl.listExams);
router.get('/:slug', requireExamStudent, examStudentCtrl.showInstructions);
router.post('/:id/start', requireExamStudent, examStudentCtrl.startAttempt);
router.get('/:slug/runner', requireExamStudent, examStudentCtrl.showRunner);

// Runner APIs (Autosave & Submission)
router.post('/attempt/:attemptId/save-answer', requireExamStudent, examSaveLimiter, examStudentCtrl.saveAnswer);
router.post('/attempt/:attemptId/submit', requireExamStudent, examStudentCtrl.submitAttempt);

// Student Result Route
router.get('/results/:attemptId', requireExamStudent, examStudentCtrl.showResult);

module.exports = router;

