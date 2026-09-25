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
router.get('/certificate', (req, res, next) => {
  console.log('=== CERTIFICATE ROUTE HIT ===');
  console.log(req.query);
  next();
}, certPublicCtrl.showCertificatePage);
router.post('/certificate', certPublicCtrl.handleCertificateAction);
router.post('/certificate/verify', certPublicCtrl.verifyCertificate);
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
