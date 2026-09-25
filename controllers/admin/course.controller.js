/**
 * controllers/admin/course.controller.js
 * CRUD for courses — with password hashing, slug generation, Cloudinary uploads,
 * and cascade delete.
 */
const bcrypt = require('bcryptjs');
const Course = require('../../models/Course');
const Video = require('../../models/Video');
const { paginate } = require('../../utils/pagination');
const { getBaseUrl } = require('../../utils/helpers');
const cloudinary = require('../../config/cloudinary');

// List courses
exports.index = async (req, res, next) => {
  try {
    const { page = 1, search = '' } = req.query;
    const filter = {};
    if (search) filter.title = { $regex: search, $options: 'i' };

    const result = await paginate(Course, filter, {
      page,
      limit: 10,
      sort: { createdAt: -1 }
    });

    console.log('===== COURSE DATA =====');

    result.docs.forEach(course => {
      console.log({
        title: course.title,
        certificateEnabled: course.certificateEnabled,
        certificateCompletionDate: course.certificateCompletionDate
      });
    });

    // Count videos per course
    const courseIds = result.docs.map(c => c._id);

    const videoCounts = await Video.aggregate([
      { $match: { courseId: { $in: courseIds } } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } },
    ]);

    const videoCountMap = {};

    videoCounts.forEach(v => {
      videoCountMap[v._id.toString()] = v.count;
    });

    res.render('admin/courses/index', {
      title: 'Courses — Admin',
      layout: 'layouts/admin',
      ...result,
      search,
      videoCountMap,
      currentPage: 'courses'
    });

  } catch (err) {
    next(err);
  }
};

// Show create form
exports.create = (req, res) => {
  res.render('admin/courses/form', {
    title: 'Add Course — Admin',
    layout: 'layouts/admin',
    course: null,
    currentPage: 'courses',
    // appUrl is injected globally by app.js middleware — no override needed
  });
};

// Handle create
exports.store = async (req, res, next) => {
  try {
    const { title, description, password, isActive, certificateCompletionDate } = req.body;

    // Validate 4-digit password
    if (!password || !/^\d{4}$/.test(password)) {
      req.flash('error', 'Course password must be exactly 4 digits.');
      return res.redirect('/admin/courses/create');
    }

    // Cloudinary upload — req.file.path is the secure_url
    const thumbnail = req.file ? req.file.path : null;
    const thumbnailPublicId = req.file ? req.file.filename : null;

    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, rounds);

    const isCertEnabled = req.body.certificateEnabled === 'on' || req.body.certificateEnabled === 'true' || req.body.certificateEnabled === true;

    const course = await Course.create({
      title,
      description,
      thumbnail,
      thumbnailPublicId,
      passwordHash,
      isActive: isActive === 'on' || isActive === 'true' || isActive === true,
      certificateCompletionDate: certificateCompletionDate ? new Date(certificateCompletionDate) : null,
      certificateEnabled: isCertEnabled,
    });

    console.log('certificateEnabled from form (create):', req.body.certificateEnabled);
    console.log('certificateEnabled after create:', course.certificateEnabled);

    req.flash('success', 'Course created successfully.');
    res.redirect('/admin/courses');
  } catch (err) {
    console.error('COURSE CREATE ERROR');
    console.error(err);
    next(err);
  }

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
      // appUrl is injected globally by app.js middleware — no override needed
    });
  } catch (err) { next(err); }
};

// Handle update
exports.update = async (req, res, next) => {

  try {
    const { title, description, password, isActive, certificateEnabled } = req.body;
    const course = await Course.findById(req.params.id);
    if (!course) { req.flash('error', 'Course not found.'); return res.redirect('/admin/courses'); }

    if (req.file) {
      // Delete old thumbnail from Cloudinary (if exists)
      if (course.thumbnailPublicId) {
        try {
          await cloudinary.uploader.destroy(course.thumbnailPublicId);
        } catch (e) {
          console.error('Cloudinary delete failed (old thumbnail):', e.message);
        }
      }
      // Save new Cloudinary URL + public_id
      course.thumbnail = req.file.path;
      course.thumbnailPublicId = req.file.filename;
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
    // Update or clear the admin-set certificate completion date
    course.certificateCompletionDate = req.body.certificateCompletionDate
      ? new Date(req.body.certificateCompletionDate)
      : null;

    // Handle certificateEnabled toggle
    const isCertEnabled = req.body.certificateEnabled === 'on' || req.body.certificateEnabled === 'true' || req.body.certificateEnabled === true;
    console.log('certificateEnabled from form:', req.body.certificateEnabled);
    course.certificateEnabled = isCertEnabled;
    console.log('certificateEnabled before save:', course.certificateEnabled);

    await course.save();

    const verifyCourse = await Course.findById(course._id);
    console.log('certificateEnabled after save:', verifyCourse.certificateEnabled);

    req.flash('success', 'Course updated successfully.');
    res.redirect('/admin/courses');
  } catch (err) {
    console.error('COURSE CREATE ERROR');
    console.error(err);
    next(err);
  }
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
    // getBaseUrl: derives from request host. Never hardcoded.
    const baseUrl = getBaseUrl(req);
    res.json({ success: true, slug: newSlug, url: `${baseUrl}/course/${newSlug}` });
  } catch (err) { next(err); }
};

// Delete course (cascade deletes videos + Cloudinary thumbnail)
exports.destroy = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) { req.flash('error', 'Course not found.'); return res.redirect('/admin/courses'); }

    // Delete thumbnail from Cloudinary
    if (course.thumbnailPublicId) {
      try {
        await cloudinary.uploader.destroy(course.thumbnailPublicId);
      } catch (e) {
        console.error('Cloudinary delete failed (course delete):', e.message);
      }
    }

    // Cascade delete all videos
    await Video.deleteMany({ courseId: course._id });
    await course.deleteOne();

    req.flash('success', 'Course and all related videos deleted.');
    res.redirect('/admin/courses');
  } catch (err) { next(err); }
};
