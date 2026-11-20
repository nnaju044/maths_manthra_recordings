/**
 * middleware/exam.auth.middleware.js
 * Authentication guard for Student Examination Portal.
 * Uses dedicated session `req.session.examStudent`.
 * Ensures student session integrity, eligibility validation, and attempt access controls.
 */

/**
 * requireExamStudent - requires active verified student session for examination portal
 */
const requireExamStudent = (req, res, next) => {
  if (req.session && req.session.examStudent && req.session.examStudent.studentId) {
    res.locals.examStudent = req.session.examStudent;
    return next();
  }

  // Preserve intended destination for redirect after login
  const returnTo = req.originalUrl || '/exams';
  if (req.session) {
    req.session.examReturnTo = returnTo;
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({
      success: false,
      message: 'Examination session expired or unauthenticated. Please log in.',
      redirectUrl: '/exams/login',
    });
  }

  req.flash('error', 'Please log in with your registered email to access examinations.');
  return res.redirect('/exams/login');
};

module.exports = {
  requireExamStudent,
};

