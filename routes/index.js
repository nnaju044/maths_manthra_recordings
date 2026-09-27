/**
 * routes/index.js
 * Public routes — course access (password gate, video list, video player).
 */
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const courseCtrl = require('../controllers/course.controller');
const certPublicCtrl = require('../controllers/certificate.controller');
const { requireCourseAccess } = require('../middleware/auth.middleware');

// Root → redirect to admin login
router.get('/', (req, res) => {
  res.redirect('/auth/login');
});

// Certificate portal (public, no login required)
router.get('/certificate', certPublicCtrl.showCertificatePage);
router.post('/certificate', certPublicCtrl.handleCertificateAction);
router.post('/certificate/verify', certPublicCtrl.verifyCertificate);

// ── OTP Rate Limiters ────────────────────────────────────────────────────────
const sendOTPLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { success: false, message: 'Too many OTP requests. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

const verifyOTPLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { success: false, message: 'Too many verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

// OTP verification routes
router.post('/certificate/send-otp', sendOTPLimiter, certPublicCtrl.sendOTP);
router.post('/certificate/verify-otp', verifyOTPLimiter, certPublicCtrl.verifyOTP);
router.post('/certificate/resend-otp', sendOTPLimiter, certPublicCtrl.resendOTP);

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
router.get('/course/:slug/watch', requireCourseAccess, courseCtrl.showCourseVideos);
router.get('/course/:slug/watch/:videoId', requireCourseAccess, courseCtrl.showVideoPlayer);
router.get('/course/:slug/thumbnail/:videoId', requireCourseAccess, courseCtrl.getVideoThumbnail);

module.exports = router;
