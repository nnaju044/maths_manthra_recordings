/**
 * controllers/admin/video.controller.js
 * CRUD for videos — Day 1, Day 2, … within a course.
 * Supports drag-and-drop reordering via AJAX.
 */
const Video = require('../../models/Video');
const Course = require('../../models/Course');
const { extractYouTubeId } = require('../../utils/youtube');
const { paginate } = require('../../utils/pagination');

// List videos (with optional course filter)
exports.index = async (req, res, next) => {
  try {
    const { page = 1, search = '', courseId = '' } = req.query;
    const filter = {};
    if (search) filter.title = { $regex: search, $options: 'i' };
    if (courseId) filter.courseId = courseId;

    const result = await paginate(Video, filter, {
      page, limit: 20, sort: { order: 1, dayNumber: 1 }, populate: [{ path: 'courseId' }],
    });
    const courses = await Course.find().sort('title');

    res.render('admin/videos/index', {
      title: 'Videos — Admin',
      layout: 'layouts/admin',
      ...result,
      search,
      courseFilter: courseId,
      courses,
      currentPage: 'videos',
    });
  } catch (err) { next(err); }
};

// Show create form
exports.create = async (req, res, next) => {
  try {
    const courses = await Course.find().sort('title');
    // Auto-suggest next day number for selected course
    const preselectedCourse = req.query.courseId || '';
    let nextDay = 1;
    if (preselectedCourse) {
      const maxVideo = await Video.findOne({ courseId: preselectedCourse }).sort({ dayNumber: -1 });
      if (maxVideo) nextDay = maxVideo.dayNumber + 1;
    }

    res.render('admin/videos/form', {
      title: 'Add Video — Admin',
      layout: 'layouts/admin',
      video: null,
      courses,
      preselectedCourse,
      nextDay,
      currentPage: 'videos',
    });
  } catch (err) { next(err); }
};

// Handle create
exports.store = async (req, res, next) => {
  try {
    const { title, description, youtubeUrl, courseId, dayNumber, pdfTitle, pdfUrl } = req.body;

    // Extract video ID server-side
    const youtubeId = extractYouTubeId(youtubeUrl);
    if (!youtubeId) {
      req.flash('error', 'Invalid YouTube URL. Please check and try again.');
      return res.redirect(`/admin/videos/create?courseId=${courseId || ''}`);
    }

    // Auto-set order based on day number
    const maxOrderVideo = await Video.findOne({ courseId }).sort({ order: -1 });
    const order = maxOrderVideo ? maxOrderVideo.order + 1 : 0;

    await Video.create({
      title,
      description,
      youtubeUrl,
      youtubeId,
      courseId,
      dayNumber: parseInt(dayNumber) || 1,
      order,
      pdfTitle: pdfTitle || undefined,
      pdfUrl: pdfUrl || undefined,
    });

    req.flash('success', 'Video added successfully.');
    res.redirect(`/admin/videos?courseId=${courseId || ''}`);
  } catch (err) { next(err); }
};

// Show edit form
exports.edit = async (req, res, next) => {
  try {
    const [video, courses] = await Promise.all([
      Video.findById(req.params.id),
      Course.find().sort('title'),
    ]);
    if (!video) { req.flash('error', 'Video not found.'); return res.redirect('/admin/videos'); }

    res.render('admin/videos/form', {
      title: 'Edit Video — Admin',
      layout: 'layouts/admin',
      video,
      courses,
      preselectedCourse: video.courseId.toString(),
      nextDay: video.dayNumber,
      currentPage: 'videos',
    });
  } catch (err) { next(err); }
};

// Handle update
exports.update = async (req, res, next) => {
  try {
    const { title, description, youtubeUrl, courseId, dayNumber, pdfTitle, pdfUrl } = req.body;
    const video = await Video.findById(req.params.id);
    if (!video) { req.flash('error', 'Video not found.'); return res.redirect('/admin/videos'); }

    if (youtubeUrl) {
      const id = extractYouTubeId(youtubeUrl);
      if (!id) {
        req.flash('error', 'Invalid YouTube URL.');
        return res.redirect(`/admin/videos/${req.params.id}/edit`);
      }
      video.youtubeId = id;
      video.youtubeUrl = youtubeUrl;
    }

    Object.assign(video, {
      title,
      description,
      courseId,
      dayNumber: parseInt(dayNumber) || 1,
      pdfTitle: pdfTitle || undefined,
      pdfUrl: pdfUrl || undefined,
    });
    await video.save();

    req.flash('success', 'Video updated successfully.');
    res.redirect(`/admin/videos?courseId=${courseId || ''}`);
  } catch (err) { next(err); }
};

// Delete video
exports.destroy = async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) { req.flash('error', 'Video not found.'); return res.redirect('/admin/videos'); }
    const courseId = video.courseId;
    await video.deleteOne();
    req.flash('success', 'Video deleted.');
    res.redirect(`/admin/videos?courseId=${courseId || ''}`);
  } catch (err) { next(err); }
};

// Reorder videos (AJAX — receives array of { id, order })
exports.reorder = async (req, res, next) => {
  try {
    const { items } = req.body; // [{ id: '...', order: 0 }, { id: '...', order: 1 }, ...]
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'Invalid data' });
    }

    const ops = items.map(item => ({
      updateOne: {
        filter: { _id: item.id },
        update: { $set: { order: item.order } },
      },
    }));

    await Video.bulkWrite(ops);
    res.json({ success: true });
  } catch (err) { next(err); }
};
