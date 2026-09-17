/**
 * controllers/admin/dashboard.controller.js
 * Admin dashboard — simplified stats (courses, videos, recent activity).
 */
const Course = require('../../models/Course');
const Video = require('../../models/Video');

exports.getDashboard = async (req, res, next) => {
  try {
    const [totalCourses, totalVideos, activeCourses, recentCourses, recentVideos] = await Promise.all([
      Course.countDocuments(),
      Video.countDocuments(),
      Course.countDocuments({ isActive: true }),
      Course.find().sort({ createdAt: -1 }).limit(5),
      Video.find().sort({ createdAt: -1 }).limit(5).populate('courseId'),
    ]);

    res.render('admin/dashboard', {
      title: 'Dashboard — Admin',
      layout: 'layouts/admin',
      totalCourses,
      totalVideos,
      activeCourses,
      recentCourses,
      recentVideos,
      currentPage: 'dashboard',
    });
  } catch (err) {
    next(err);
  }
};
