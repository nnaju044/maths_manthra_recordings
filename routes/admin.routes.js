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
const questionCtrl = require('../controllers/admin/question.controller');
const examCtrl = require('../controllers/admin/examination.controller');
const examDashCtrl = require('../controllers/admin/exam.dashboard.controller');

// All admin routes require auth (superadmin JWT)
router.use(requireAuth);

// Root /admin or /admin/ redirect to dashboard
router.get('/', (req, res) => res.redirect(303, '/admin/dashboard'));

// Dashboard (support both GET and redirected POST)
router.route('/dashboard')
  .get(dashCtrl.getDashboard)
  .post(dashCtrl.getDashboard);

// Courses
router.get('/courses', courseCtrl.index);
router.get('/courses/create', courseCtrl.create);
router.post('/courses', upload.single('thumbnail'), courseCtrl.store);
router.get('/courses/:id/edit', courseCtrl.edit);
router.post('/courses/:id', upload.single('thumbnail'), courseCtrl.update);
router.post('/courses/:id/toggle-active', courseCtrl.toggleActive);
router.post('/courses/:id/regenerate-slug', courseCtrl.regenerateSlug);
router.post('/courses/:id/delete', courseCtrl.destroy);

// Videos (support both GET and redirected POST from serverless environments)
router.route('/videos')
  .get(videoCtrl.index)
  .post(videoCtrl.store);
router.get('/videos/create', videoCtrl.create);
router.post('/videos/create', videoCtrl.store);
router.get('/videos/:id/edit', videoCtrl.edit);
router.post('/videos/:id', videoCtrl.update);
router.post('/videos/:id/delete', videoCtrl.destroy);
router.post('/videos/reorder', videoCtrl.reorder);

// Certificates (support both GET and redirected POST from serverless environments)
router.route('/certificates')
  .get(certCtrl.index)
  .post(certCtrl.index);
router.get('/certificates/create', certCtrl.getCreate);
router.post('/certificates/create', certCtrl.postCreate);
router.get('/certificates/upload', certCtrl.getUpload);
router.post('/certificates/upload', uploadExcel.single('file'), certCtrl.postUpload);
router.get('/certificates/:id/edit', certCtrl.getEdit);
router.post('/certificates/:id/update', certCtrl.postUpdate);
router.post('/certificates/:id/toggle-active', certCtrl.toggleActive);
router.post('/certificates/:id/delete', certCtrl.deleteStudent);
router.get('/certificates/students', (req, res) => res.redirect('/admin/certificates'));

// ── Examinations & Question Bank Module ──────────────────────────────────────
// Exam Dashboard
router.get('/examinations/dashboard', examDashCtrl.getDashboard);

// Question Bank
router.get('/questions', questionCtrl.index);
router.get('/questions/create', questionCtrl.create);
router.post('/questions', upload.single('image'), questionCtrl.store);
router.get('/questions/template', questionCtrl.downloadTemplate);
router.get('/questions/import', questionCtrl.getImport);
router.post('/questions/import', uploadExcel.single('file'), questionCtrl.postImport);
router.get('/questions/:id/edit', questionCtrl.edit);
router.post('/questions/:id', upload.single('image'), questionCtrl.update);
router.post('/questions/:id/toggle-status', questionCtrl.toggleStatus);

// Examinations Management
router.get('/examinations', examCtrl.index);
router.get('/examinations/create', examCtrl.create);
router.post('/examinations', upload.single('thumbnail'), examCtrl.store);
router.get('/examinations/:id/edit', examCtrl.edit);
router.post('/examinations/:id', upload.single('thumbnail'), examCtrl.update);
router.post('/examinations/:id/status', examCtrl.updateStatus);

module.exports = router;
