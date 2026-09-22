/**
 * routes/admin.routes.js
 * Admin panel routes — courses and videos management.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { upload, uploadExcel } = require('../middleware/upload.middleware');

const dashCtrl = require('../controllers/admin/dashboard.controller');
const courseCtrl = require('../controllers/admin/course.controller');
const videoCtrl = require('../controllers/admin/video.controller');
const certCtrl = require('../controllers/admin/certificate.controller');

// All admin routes require auth (superadmin JWT)
router.use(requireAuth);

// Dashboard
router.get('/dashboard', dashCtrl.getDashboard);

// Courses
router.get('/courses', courseCtrl.index);
router.get('/courses/create', courseCtrl.create);
router.post('/courses', upload.single('thumbnail'), courseCtrl.store);
router.get('/courses/:id/edit', courseCtrl.edit);
router.post('/courses/:id', upload.single('thumbnail'), courseCtrl.update);
router.post('/courses/:id/toggle-active', courseCtrl.toggleActive);
router.post('/courses/:id/regenerate-slug', courseCtrl.regenerateSlug);
router.post('/courses/:id/delete', courseCtrl.destroy);

// Videos
router.get('/videos', videoCtrl.index);
router.get('/videos/create', videoCtrl.create);
router.post('/videos', videoCtrl.store);
router.get('/videos/:id/edit', videoCtrl.edit);
router.post('/videos/:id', videoCtrl.update);
router.post('/videos/:id/delete', videoCtrl.destroy);
router.post('/videos/reorder', videoCtrl.reorder);

// Certificates
router.get('/certificates/upload', certCtrl.getUpload);
router.post('/certificates/upload', uploadExcel.single('file'), certCtrl.postUpload);
router.get('/certificates/students', certCtrl.getStudents);
router.post('/certificates/students/:id/delete', certCtrl.deleteStudent);

module.exports = router;
