/**
 * controllers/admin/video.controller.js
 * CRUD for videos — Day 1, Day 2, … within a course.
 * Includes idempotency protection, safe deletion, and drag-and-drop reordering.
 */
const mongoose = require('mongoose');
const Video = require('../../models/Video');
const Course = require('../../models/Course');
const cloudinary = require('../../config/cloudinary');
const { extractYouTubeId } = require('../../utils/youtube');
const { paginate } = require('../../utils/pagination');

// Safe redirect helper that guarantees session persistence before sending 303 redirect
const safeRedirect = (req, res, target) => {
  if (req.session && typeof req.session.save === 'function') {
    return req.session.save(() => res.redirect(303, target));
  }
  return res.redirect(303, target);
};

// List videos (with optional course filter)
exports.index = async (req, res, next) => {
  try {
    const { page = 1, search = '', courseId = '' } = req.query;
    const filter = {};
    if (search && search.trim()) filter.title = { $regex: search.trim(), $options: 'i' };
    if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
      filter.courseId = courseId;
    }

    const result = await paginate(Video, filter, {
      page: parseInt(page, 10) || 1,
      limit: 20,
      sort: { order: 1, dayNumber: 1 },
      populate: [{ path: 'courseId' }],
    });
    const courses = await Course.find().sort('title');

    res.render('admin/videos/index', {
      title: 'Videos — Admin',
      layout: 'layouts/admin',
      ...result,
      search: (search || '').trim(),
      courseFilter: courseId || '',
      courses,
      currentPage: 'videos',
    });
  } catch (err) {
    console.error('[Video Index] Error listing videos:', err);
    next(err);
  }
};

// Show create form
exports.create = async (req, res, next) => {
  try {
    const courses = await Course.find().sort('title');
    // Auto-suggest next day number for selected course
    const preselectedCourse = req.query.courseId || '';
    let nextDay = 1;
    if (preselectedCourse && mongoose.Types.ObjectId.isValid(preselectedCourse)) {
      const maxVideo = await Video.findOne({ courseId: preselectedCourse }).sort({ dayNumber: -1 });
      if (maxVideo) nextDay = maxVideo.dayNumber + 1;
    }

    // Generate unique upload operation ID for backend idempotency
    const uploadOperationId = `vid_op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    res.render('admin/videos/form', {
      title: 'Add Video — Admin',
      layout: 'layouts/admin',
      video: null,
      courses,
      preselectedCourse,
      nextDay,
      uploadOperationId,
      currentPage: 'videos',
    });
  } catch (err) {
    console.error('[Video Create Form] Error rendering create form:', err);
    next(err);
  }
};

// Handle create with idempotency and duplicate upload protection
exports.store = async (req, res, next) => {
  try {
    // If request has no title and no youtubeUrl (e.g. redirected POST without body), delegate to index
    if (!req.body || (!req.body.title && !req.body.youtubeUrl)) {
      console.log('[Video Create] Empty POST received at /admin/videos, delegating to index');
      return exports.index(req, res, next);
    }

    const {
      title,
      description,
      youtubeUrl,
      courseId,
      dayNumber,
      pdfTitle,
      pdfUrl,
      uploadOperationId,
    } = req.body;

    const opId = (uploadOperationId || '').trim();
    const cleanTitle = (title || '').trim();
    const cleanYoutubeUrl = (youtubeUrl || '').trim();

    console.log(`[Video Create] Upload operation started. opId: "${opId}", title: "${cleanTitle}", courseId: "${courseId}"`);

    // 1. Validation: Title
    if (!cleanTitle) {
      req.flash('error', 'Video title is required.');
      return safeRedirect(req, res, `/admin/videos/create?courseId=${courseId || ''}`);
    }

    // 2. Validation: Course selection
    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      req.flash('error', 'Please select a valid course.');
      return safeRedirect(req, res, `/admin/videos/create?courseId=${courseId || ''}`);
    }

    const courseExists = await Course.findById(courseId);
    if (!courseExists) {
      req.flash('error', 'The selected course does not exist.');
      return safeRedirect(req, res, '/admin/videos/create');
    }

    // 3. Validation: YouTube URL & Video ID extraction
    const youtubeId = extractYouTubeId(cleanYoutubeUrl);
    if (!youtubeId) {
      req.flash('error', 'Invalid YouTube URL. Please check and try again.');
      return safeRedirect(req, res, `/admin/videos/create?courseId=${courseId || ''}`);
    }

    // 4. Backend Idempotency: Check if an upload with this operation ID was already completed
    if (opId) {
      const existingByOpId = await Video.findOne({ uploadOperationId: opId });
      if (existingByOpId) {
        console.warn(`[Video Create] Duplicate upload prevented via uploadOperationId: "${opId}"`);
        req.flash('info', 'Video has already been added.');
        return safeRedirect(req, res, `/admin/videos?courseId=${existingByOpId.courseId || courseId}`);
      }
    }

    // 5. Debounce rapid duplicate submissions (e.g. rapid double-clicks without unique opId)
    const recentDuplicate = await Video.findOne({
      courseId,
      youtubeId,
      createdAt: { $gte: new Date(Date.now() - 15000) },
    });
    if (recentDuplicate) {
      console.warn(`[Video Create] Debounced rapid duplicate submission for youtubeId: "${youtubeId}" in course: ${courseId}`);
      req.flash('info', 'Video has already been added.');
      return safeRedirect(req, res, `/admin/videos?courseId=${courseId}`);
    }

    // 6. Auto-set order based on day number / max existing order
    const maxOrderVideo = await Video.findOne({ courseId }).sort({ order: -1 });
    const order = maxOrderVideo ? maxOrderVideo.order + 1 : 0;

    // 7. Atomic MongoDB insertion
    const video = await Video.create({
      title: cleanTitle,
      description: (description || '').trim(),
      youtubeUrl: cleanYoutubeUrl,
      youtubeId,
      courseId,
      dayNumber: parseInt(dayNumber, 10) || 1,
      order,
      pdfTitle: pdfTitle ? pdfTitle.trim() : undefined,
      pdfUrl: pdfUrl ? pdfUrl.trim() : undefined,
      uploadOperationId: opId || undefined,
    });

    console.log(`[Video Create] MongoDB save result: SUCCESS (ID: ${video._id}, title: "${video.title}", opId: "${opId || 'none'}")`);
    req.flash('success', 'Video added successfully.');
    return safeRedirect(req, res, `/admin/videos?courseId=${courseId}`);
  } catch (err) {
    console.error('[Video Create] ERROR during video creation:', err);

    // Concurrent duplicate upload catch via MongoDB sparse unique index
    if (err.code === 11000 && err.keyPattern && err.keyPattern.uploadOperationId) {
      console.warn(`[Video Create] Concurrent duplicate insertion caught by database constraint (opId: ${req.body.uploadOperationId})`);
      req.flash('info', 'Video has already been added.');
      return safeRedirect(req, res, `/admin/videos?courseId=${req.body.courseId || ''}`);
    }

    req.flash('error', err.message || 'Failed to add video. Please check the entered details.');
    return safeRedirect(req, res, `/admin/videos/create?courseId=${req.body.courseId || ''}`);
  }
};

// Show edit form
exports.edit = async (req, res, next) => {
  try {
    const videoId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      req.flash('error', 'Invalid video identifier.');
      return safeRedirect(req, res, '/admin/videos');
    }

    const [video, courses] = await Promise.all([
      Video.findById(videoId),
      Course.find().sort('title'),
    ]);
    if (!video) {
      req.flash('error', 'Video not found.');
      return safeRedirect(req, res, '/admin/videos');
    }

    res.render('admin/videos/form', {
      title: 'Edit Video — Admin',
      layout: 'layouts/admin',
      video,
      courses,
      preselectedCourse: video.courseId ? video.courseId.toString() : '',
      nextDay: video.dayNumber,
      uploadOperationId: '',
      currentPage: 'videos',
    });
  } catch (err) {
    console.error('[Video Edit Form] Error loading edit form:', err);
    req.flash('error', 'Failed to load video edit form.');
    return safeRedirect(req, res, '/admin/videos');
  }
};

// Handle update
exports.update = async (req, res, next) => {
  try {
    const videoId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      req.flash('error', 'Invalid video identifier.');
      return safeRedirect(req, res, '/admin/videos');
    }

    const video = await Video.findById(videoId);
    if (!video) {
      req.flash('error', 'Video not found.');
      return safeRedirect(req, res, '/admin/videos');
    }

    const { title, description, youtubeUrl, courseId, dayNumber, pdfTitle, pdfUrl } = req.body;
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) {
      req.flash('error', 'Video title is required.');
      return safeRedirect(req, res, `/admin/videos/${videoId}/edit`);
    }

    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      req.flash('error', 'Please select a valid course.');
      return safeRedirect(req, res, `/admin/videos/${videoId}/edit`);
    }

    const targetCourse = await Course.findById(courseId);
    if (!targetCourse) {
      req.flash('error', 'The selected course does not exist.');
      return safeRedirect(req, res, `/admin/videos/${videoId}/edit`);
    }

    // Only update YouTube fields if provided and valid
    if (youtubeUrl && youtubeUrl.trim()) {
      const cleanUrl = youtubeUrl.trim();
      const id = extractYouTubeId(cleanUrl);
      if (!id) {
        req.flash('error', 'Invalid YouTube URL.');
        return safeRedirect(req, res, `/admin/videos/${videoId}/edit`);
      }
      video.youtubeId = id;
      video.youtubeUrl = cleanUrl;
    }

    // Update metadata fields without touching or re-uploading other media
    Object.assign(video, {
      title: cleanTitle,
      description: (description || '').trim(),
      courseId,
      dayNumber: parseInt(dayNumber, 10) || 1,
      pdfTitle: pdfTitle ? pdfTitle.trim() : undefined,
      pdfUrl: pdfUrl ? pdfUrl.trim() : undefined,
    });
    await video.save();

    console.log(`[Video Update] Video metadata updated successfully: "${video.title}" (ID: ${video._id})`);
    req.flash('success', 'Video updated successfully.');
    return safeRedirect(req, res, `/admin/videos?courseId=${courseId || ''}`);
  } catch (err) {
    console.error('[Video Update] Error updating video:', err);
    req.flash('error', err.message || 'Failed to update video.');
    return safeRedirect(req, res, `/admin/videos/${req.params.id}/edit`);
  }
};

// Delete video safely with storage synchronization and repeated-delete idempotency
exports.destroy = async (req, res, next) => {
  const videoId = req.params.id;
  console.log(`[Video Delete] Delete operation started for video ID: "${videoId}"`);

  // 1. Validate video ID format
  if (!mongoose.Types.ObjectId.isValid(videoId)) {
    console.warn(`[Video Delete] Invalid video ID format: "${videoId}"`);
    req.flash('error', 'Invalid video identifier.');
    return safeRedirect(req, res, '/admin/videos');
  }

  try {
    // 2. Verify video record exists
    const video = await Video.findById(videoId);
    if (!video) {
      console.warn(`[Video Delete] Video not found or already deleted: "${videoId}"`);
      req.flash('error', 'Video has already been deleted or does not exist.');
      return safeRedirect(req, res, '/admin/videos');
    }

    const courseId = video.courseId ? video.courseId.toString() : '';
    const videoTitle = video.title;

    // 3. Handle external storage deletion if any associated assets exist (e.g. Cloudinary thumbnail)
    if (video.thumbnailPublicId) {
      try {
        console.log(`[Video Delete] External storage deletion started for asset: ${video.thumbnailPublicId}`);
        const result = await cloudinary.uploader.destroy(video.thumbnailPublicId);
        console.log(`[Video Delete] External storage deletion result:`, result);
      } catch (storageErr) {
        console.error(`[Video Delete] Warning: External storage deletion failed for asset ${video.thumbnailPublicId}:`, storageErr.message);
      }
    }

    // 4. Remove the database record
    await Video.deleteOne({ _id: video._id });
    console.log(`[Video Delete] Database deletion result: successfully deleted video "${videoTitle}" (${videoId})`);

    req.flash('success', `Video "${videoTitle}" deleted successfully.`);
    return safeRedirect(req, res, `/admin/videos?courseId=${courseId}`);
  } catch (err) {
    console.error(`[Video Delete] Failed operation for video "${videoId}":`, err);
    req.flash('error', 'Failed to delete video. Please try again.');
    return safeRedirect(req, res, '/admin/videos');
  }
};

// Reorder videos (AJAX — receives array of { id, order })
exports.reorder = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'Invalid data format' });
    }

    // Validate ObjectIds and order numbers
    const validItems = items.filter(
      item => item && item.id && mongoose.Types.ObjectId.isValid(item.id) && typeof item.order === 'number'
    );

    if (validItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid items to reorder' });
    }

    const ops = validItems.map(item => ({
      updateOne: {
        filter: { _id: item.id },
        update: { $set: { order: item.order } },
      },
    }));

    await Video.bulkWrite(ops);
    console.log(`[Video Reorder] Successfully reordered ${validItems.length} videos`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Video Reorder] Error during reorder:', err);
    return res.status(500).json({ success: false, message: 'Failed to reorder videos' });
  }
};
