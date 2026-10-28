/**
 * routes/index.js
 * Public routes — course access (password gate, video list, video player).
 */
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const courseCtrl = require('../controllers/course.controller');
const certPublicCtrl = require('../controllers/certificate.controller');
const scoresCtrl = require('../controllers/scores.controller');
const verifyCtrl = require('../controllers/verify.controller');
const { requireCourseAccess } = require('../middleware/auth.middleware');

// Root → redirect to admin login
router.get('/', (req, res) => {
  res.redirect('/auth/login');
});

// ── Public Certificate & Student Verification ─────────────────────────────────
router.get('/verify', verifyCtrl.showVerifySearch);
router.get('/verify/:studentId', verifyCtrl.verifyCertificatePublic);

// Certificate portal (public, no login required)
router.get('/certificate', certPublicCtrl.showCertificatePage);
router.post('/certificate', certPublicCtrl.handleCertificateAction);
router.post('/certificate/verify', certPublicCtrl.verifyCertificate);

// Student Scores & Performance Evaluation portal (public, no login required)
router.get('/scores', scoresCtrl.showScoresPage);
router.post('/scores/verify', scoresCtrl.verifyScoresEmail);

// ── OTP Rate Limiters ────────────────────────────────────────────────────────
const sendOTPLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { success: false, message: 'Too many OTP requests. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.ip,
});

const verifyOTPLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { success: false, message: 'Too many verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => req.ip,
});

// OTP verification routes
router.post('/certificate/send-otp', sendOTPLimiter, certPublicCtrl.sendOTP);
router.post('/certificate/verify-otp', verifyOTPLimiter, certPublicCtrl.verifyOTP);
router.post('/certificate/resend-otp', sendOTPLimiter, certPublicCtrl.resendOTP);

router.post('/scores/send-otp', sendOTPLimiter, scoresCtrl.sendOTP);
router.post('/scores/verify-otp', verifyOTPLimiter, scoresCtrl.verifyOTP);
router.post('/scores/resend-otp', sendOTPLimiter, scoresCtrl.resendOTP);

router.get('/certificate/download/:certificateId', certPublicCtrl.downloadCertificate);

// Rate limiting for password verification — 10 attempts per 15 minutes per IP
const coursePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many password attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Course password gate (public)
router.get('/course/:slug', courseCtrl.showPasswordGate);
router.post('/course/:slug/verify', coursePasswordLimiter, courseCtrl.verifyPassword);

// Course content (requires valid course cookie)
router.route('/course/:slug/watch')
  .get(requireCourseAccess, courseCtrl.showCourseVideos)
  .post(requireCourseAccess, courseCtrl.showCourseVideos);

router.route('/course/:slug/watch/:videoId')
  .get(requireCourseAccess, courseCtrl.showVideoPlayer)
  .post(requireCourseAccess, courseCtrl.showVideoPlayer);

router.route('/course/:slug/thumbnail/:videoId')
  .get(requireCourseAccess, courseCtrl.getVideoThumbnail)
  .post(requireCourseAccess, courseCtrl.getVideoThumbnail);

module.exports = router;
