/**
 * controllers/auth.controller.js
 * Admin-only authentication — login and logout.
 * No student registration, no forgot/reset password.
 */
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const issueToken = (res, user) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  const maxAge = parseInt(process.env.COOKIE_MAX_AGE) || 7 * 24 * 60 * 60 * 1000;

  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn });

  res.cookie('mm_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
  });
};

// ─── GET /auth/login ──────────────────────────────────────────────────────────
exports.getLogin = (req, res) => {
  // If already logged in, redirect to admin dashboard
  if (req.cookies?.mm_token) {
    try {
      jwt.verify(req.cookies.mm_token, process.env.JWT_SECRET);
      return res.redirect('/admin/dashboard');
    } catch {
      res.clearCookie('mm_token');
    }
  }
  res.render('auth/login', { title: 'Admin Login — Maths Manthra', errors: [], layout: false });
};

// ─── POST /auth/login ─────────────────────────────────────────────────────────
exports.postLogin = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/login', {
      title: 'Admin Login — Maths Manthra',
      errors: errors.array(),
      old: req.body,
      layout: false,
    });
  }

  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, role: 'superadmin' }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.render('auth/login', {
        title: 'Admin Login — Maths Manthra',
        errors: [{ msg: 'Invalid email or password.' }],
        old: req.body,
        layout: false,
      });
    }

    if (user.status !== 'active') {
      return res.render('auth/login', {
        title: 'Admin Login — Maths Manthra',
        errors: [{ msg: 'Your account has been deactivated.' }],
        old: req.body,
        layout: false,
      });
    }

    issueToken(res, user);
    req.flash('success', `Welcome back, ${user.name}!`);
    res.redirect('/admin/dashboard');
  } catch (err) {
    next(err);
  }
};

// ─── GET /auth/logout ─────────────────────────────────────────────────────────
exports.logout = (req, res) => {
  res.clearCookie('mm_token');
  req.flash('success', 'You have been logged out.');
  res.redirect('/auth/login');
};
