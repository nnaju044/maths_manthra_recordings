/**
 * controllers/course.controller.js
 * Public-facing course access — password gate, video list, video player.
 * No student accounts needed. Access is controlled via signed cookies.
 */
const bcrypt = require('bcryptjs');
const Course = require('../models/Course');
const Video = require('../models/Video');
const { buildEmbedUrl } = require('../utils/youtube');

/**
 * GET /course/:slug
 * Show password gate — course thumbnail, name, description, password input.
 * If already authenticated via cookie, redirect to video list.
 */
exports.showPasswordGate = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const course = await Course.findOne({ slug, isActive: true });

    if (!course) {
      return res.status(404).render('404', {
        title: 'Course Not Found',
        message: 'This course does not exist or has been deactivated.',
        layout: false,
      });
    }

    // Already authenticated? Redirect to videos
    const cookieName = `mm_course_${slug}`;
    if (req.signedCookies?.[cookieName] === 'granted') {
      return res.redirect(`/course/${slug}/watch`);
    }

    res.render('course/password', {
      title: `${course.title} — Maths Manthra`,
      course,
      error: null,
      layout: false,
    });
  } catch (err) { next(err); }
};

/**
 * POST /course/:slug/verify
 * Verify course password. On success, set signed cookie with 30-day expiry.
 */
exports.verifyPassword = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { password } = req.body;
    const course = await Course.findOne({ slug, isActive: true });

    if (!course) {
      return res.status(404).render('404', {
        title: 'Course Not Found',
        message: 'This course does not exist or has been deactivated.',
        layout: false,
      });
    }

    const isMatch = await bcrypt.compare(password || '', course.passwordHash);

    if (!isMatch) {
      return res.render('course/password', {
        title: `${course.title} — Maths Manthra`,
        course,
        error: 'Incorrect password. Please try again.',
        layout: false,
      });
    }

    // Set signed cookie — 30 days
    const cookieName = `mm_course_${slug}`;
    res.cookie(cookieName, 'granted', {
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.redirect(`/course/${slug}/watch`);
  } catch (err) { next(err); }
};

/**
 * GET /course/:slug/watch
 * Show all videos for the authenticated course.
 */
exports.showCourseVideos = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const course = await Course.findOne({ slug, isActive: true });

    if (!course) {
      return res.status(404).render('404', {
        title: 'Course Not Found',
        message: 'This course does not exist or has been deactivated.',
        layout: false,
      });
    }

    const videos = await Video.find({ courseId: course._id }).sort({ order: 1, dayNumber: 1 });

    res.render('course/videos', {
      title: `${course.title} — Maths Manthra`,
      course,
      videos,
      layout: false,
    });
  } catch (err) { next(err); }
};

/**
 * GET /course/:slug/watch/:videoId
 * Show video player page with embedded YouTube player and prev/next navigation.
 */
exports.showVideoPlayer = async (req, res, next) => {
  try {
    const { slug, videoId } = req.params;
    const course = await Course.findOne({ slug, isActive: true });

    if (!course) {
      return res.status(404).render('404', {
        title: 'Course Not Found',
        message: 'This course does not exist or has been deactivated.',
        layout: false,
      });
    }

    if (!require('mongoose').Types.ObjectId.isValid(videoId)) {
      return res.redirect(`/course/${slug}/watch`);
    }

    const video = await Video.findOne({ _id: videoId, courseId: course._id });

    if (!video) {
      return res.redirect(`/course/${slug}/watch`);
    }

    // Get all videos for prev/next navigation
    const allVideos = await Video.find({ courseId: course._id }).sort({ order: 1, dayNumber: 1 });
    const currentIndex = allVideos.findIndex(v => v._id.toString() === videoId);
    const prevVideo = currentIndex > 0 ? allVideos[currentIndex - 1] : null;
    const nextVideo = currentIndex < allVideos.length - 1 ? allVideos[currentIndex + 1] : null;

    // Build embed URL server-side
    const embedUrl = buildEmbedUrl(video.youtubeId);

    res.render('course/player', {
      title: `${video.title} — ${course.title}`,
      course,
      video,
      embedUrl,
      prevVideo,
      nextVideo,
      totalVideos: allVideos.length,
      currentIndex: currentIndex + 1,
      layout: false,
    });
  } catch (err) { next(err); }
};

/**
 * GET /course/:slug/thumbnail/:videoId
 * Secure thumbnail proxy: streams thumbnail image server-side.
 * Never exposes raw YouTube video IDs or URLs to the client browser.
 */
exports.getVideoThumbnail = async (req, res, next) => {
  try {
    const { slug, videoId } = req.params;
    const course = await Course.findOne({ slug, isActive: true });
    if (!course) return res.status(404).end();

    if (!require('mongoose').Types.ObjectId.isValid(videoId)) {
      return res.status(404).end();
    }

    const video = await Video.findOne({ _id: videoId, courseId: course._id });
    if (!video || !video.youtubeId) return res.status(404).end();

    const ytThumbUrl = `https://img.youtube.com/vi/${video.youtubeId}/mqdefault.jpg`;
    const response = await fetch(ytThumbUrl);
    if (!response.ok) return res.status(404).end();

    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    return res.status(404).end();
  }
};
