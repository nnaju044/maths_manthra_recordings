/**
 * middleware/error.middleware.js
 * Centralised error handling middleware.
 */

/**
 * 404 handler — must be registered AFTER all routes.
 */
const notFound = (req, res) => {
  res.status(404).render('404', {
    title: 'Page Not Found',
    currentUser: res.locals.currentUser || null,
    message: `The page you're looking for doesn't exist.`,
    layout: false,
  });
};

/**
 * Global error handler — must be registered last with 4 arguments.
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.stack || err.message);

  const safeRedirect = (target) => {
    if (req.session && typeof req.session.save === 'function') {
      return req.session.save(() => res.redirect(303, target));
    }
    return res.redirect(303, target);
  };

  // Multer & Cloudinary upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    req.flash('error', 'File too large. Maximum size is 5MB.');
    return safeRedirect(req.get('Referrer') || '/admin/courses');
  }

  if (err.message && (err.message.includes('Only image files') || err.message.includes('Image file format') || err.message.includes('not allowed'))) {
    req.flash('error', err.message || 'Invalid image file format. Allowed formats: JPG, JPEG, PNG, WebP.');
    return safeRedirect(req.get('Referrer') || '/admin/courses');
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message).join(', ');
    req.flash('error', messages);
    return safeRedirect(req.get('Referrer') || '/admin/courses');
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    req.flash('error', `A record with this ${field} already exists.`);
    return safeRedirect(req.get('Referrer') || '/admin/courses');
  }

  const status = err.status || 500;
  res.status(status).render('error', {
    title: 'Something went wrong',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred.',
    currentUser: res.locals.currentUser || null,
    layout: false,
  });
};

module.exports = { notFound, errorHandler };
