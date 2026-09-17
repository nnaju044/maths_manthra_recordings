/**
 * middleware/auth.middleware.js
 * Authentication guards for admin (JWT) and course access (signed cookies).
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * requireAuth — protects admin routes. Checks JWT from cookie or header.
 */
const requireAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.mm_token;

    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      req.flash('error', 'Please log in to access this page.');
      return res.redirect('/auth/login');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.status !== 'active') {
      res.clearCookie('mm_token');
      req.flash('error', 'Session expired. Please log in again.');
      return res.redirect('/auth/login');
    }

    req.user = user;
    res.locals.currentUser = user;
    next();
  } catch (err) {
    res.clearCookie('mm_token');
    req.flash('error', 'Session expired. Please log in again.');
    return res.redirect('/auth/login');
  }
};

/**
 * requireCourseAccess — checks signed cookie for password-protected course access.
 * Cookie name: mm_course_{slug}
 * Cookie value: "granted" (set after correct password verification)
 */
const requireCourseAccess = (req, res, next) => {
  const { slug } = req.params;
  const cookieName = `mm_course_${slug}`;
  const cookieValue = req.signedCookies?.[cookieName];

  if (cookieValue === 'granted') {
    return next();
  }

  // Not authenticated for this course — redirect to password gate
  return res.redirect(`/course/${slug}`);
};

module.exports = { requireAuth, requireCourseAccess };
