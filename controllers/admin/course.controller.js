/**
 * controllers/admin/course.controller.js
 * CRUD for courses — with password hashing, slug generation, and cascade delete.
 */
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Course = require('../../models/Course');
const Video = require('../../models/Video');
const { paginate } = require('../../utils/pagination');

// List courses
exports.index = async (req, res, next) => {
  try {
    const { page = 1, search = '' } = req.query;
    const filter = {};
    if (search) filter.title = { $regex: search, $options: 'i' };

    const result = await paginate(Course, filter, { page, limit: 10, sort: { createdAt: -1 } });

    // Count videos per course
    const courseIds = result.docs.map(c => c._id);
    const videoCounts = await Video.aggregate([
      { $match: { courseId: { $in: courseIds } } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } },
    ]);
    const videoCountMap = {};
    videoCounts.forEach(v => { videoCountMap[v._id.toString()] = v.count; });

    res.render('admin/courses/index', {
      title: 'Courses — Admin',
      layout: 'layouts/admin',
      ...result,
      search,
      videoCountMap,
      currentPage: 'courses',
      appUrl: process.env.APP_URL || 'http://localhost:3000',
    });
  } catch (err) { next(err); }
};

// Show create form
exports.create = (req, res) => {
  res.render('admin/courses/form', {
    title: 'Add Course — Admin',
    layout: 'layouts/admin',
    course: null,
    currentPage: 'courses',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  });
};

// Handle create
exports.store = async (req, res, next) => {
  try {
    const { title, description, password, isActive } = req.body;

    // Validate 4-digit password
    if (!password || !/^\d{4}$/.test(password)) {
      req.flash('error', 'Course password must be exactly 4 digits.');
      return res.redirect('/admin/courses/create');
    }

    const thumbnail = req.file ? `/uploads/${req.file.filename}` : null;
    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, rounds);

    await Course.create({
      title,
      description,
      thumbnail,
      passwordHash,
      isActive: isActive === 'on' || isActive === 'true' || isActive === true,
    });

    req.flash('success', 'Course created successfully.');
    res.redirect('/admin/courses');
  } catch (err) { next(err); }
};

// Show edit form
exports.edit = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) { req.flash('error', 'Course not found.'); return res.redirect('/admin/courses'); }

    const videoCount = await Video.countDocuments({ courseId: course._id });

    res.render('admin/courses/form', {
      title: 'Edit Course — Admin',
      layout: 'layouts/admin',
      course,
      videoCount,
      currentPage: 'courses',
      appUrl: process.env.APP_URL || 'http://localhost:3000',
    });
  } catch (err) { next(err); }
};

// Handle update
exports.update = async (req, res, next) => {
  try {
    const { title, description, password, isActive } = req.body;
    const course = await Course.findById(req.params.id);
    if (!course) { req.flash('error', 'Course not found.'); return res.redirect('/admin/courses'); }

    if (req.file) {
      // Delete old thumbnail
      if (course.thumbnail) {
        const oldPath = path.join(__dirname, '../../public', course.thumbnail);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      course.thumbnail = `/uploads/${req.file.filename}`;
    }

    // Update password only if provided (non-empty)
    if (password && password.trim()) {
      if (!/^\d{4}$/.test(password)) {
        req.flash('error', 'Course password must be exactly 4 digits.');
        return res.redirect(`/admin/courses/${req.params.id}/edit`);
      }
      const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      course.passwordHash = await bcrypt.hash(password, rounds);
    }

    course.title = title;
    course.description = description;
    course.isActive = isActive === 'on' || isActive === 'true' || isActive === true;

    await course.save();
    req.flash('success', 'Course updated successfully.');
    res.redirect('/admin/courses');
  } catch (err) { next(err); }
};

// Toggle active status (AJAX)
exports.toggleActive = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.json({ success: false, message: 'Not found' });
    course.isActive = !course.isActive;
    await course.save();
    res.json({ success: true, isActive: course.isActive });
  } catch (err) { next(err); }
};

// Regenerate course slug (AJAX)
exports.regenerateSlug = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.json({ success: false, message: 'Not found' });
    const newSlug = course.regenerateSlug();
    await course.save();
    res.json({ success: true, slug: newSlug, url: `${process.env.APP_URL || 'http://localhost:3000'}/course/${newSlug}` });
  } catch (err) { next(err); }
};

// Delete course (cascade deletes videos)
exports.destroy = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) { req.flash('error', 'Course not found.'); return res.redirect('/admin/courses'); }

    // Remove thumbnail
    if (course.thumbnail) {
      const p = path.join(__dirname, '../../public', course.thumbnail);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // Cascade delete all videos
    await Video.deleteMany({ courseId: course._id });
    await course.deleteOne();

    req.flash('success', 'Course and all related videos deleted.');
    res.redirect('/admin/courses');
  } catch (err) { next(err); }
};
