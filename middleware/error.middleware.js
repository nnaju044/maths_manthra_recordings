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

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    req.flash('error', 'File too large. Maximum size is 5MB.');
    return res.redirect('back');
  }

  if (err.message && err.message.includes('Only image files')) {
    req.flash('error', err.message);
    return res.redirect('back');
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message).join(', ');
    req.flash('error', messages);
    return res.redirect('back');
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    req.flash('error', `A record with this ${field} already exists.`);
    return res.redirect('back');
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
