/**
 * app.js
 * Express application setup — middleware, view engine, routes.
 * Simplified for private recorded-class sharing (no student accounts).
 */
require('dotenv').config();
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
const express = require('express');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xssClean = require('xss-clean');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const flash = require('connect-flash');
const { formatDate, timeAgo, truncate } = require('./utils/helpers');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const app = express();

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'www.youtube.com', 'www.youtube-nocookie.com', 'cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'img.youtube.com', 'i.ytimg.com', '*.ytimg.com'],
      frameSrc: ["'self'", 'www.youtube-nocookie.com', 'www.youtube.com'],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(mongoSanitize());  // Prevent MongoDB operator injection
app.use(xssClean());       // Sanitise user input against XSS

// Rate limiting — auth routes
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: 'Too many requests from this IP, please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser with signing secret (for course access cookies)
const cookieSecret = process.env.COOKIE_SECRET || process.env.SESSION_SECRET || 'maths-manthra-cookie-secret';
app.use(cookieParser(cookieSecret));

// ─── Session (for connect-flash) ──────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'maths-manthra-session-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI, ttl: 24 * 60 * 60 }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: parseInt(process.env.SESSION_EXPIRES_IN) || 86400000,
  },
}));

app.use(flash());

// ─── View Engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// express-ejs-layouts — layout files live in views/layouts/
app.use(ejsLayouts);
app.set('layout', 'layouts/main'); // default layout
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Trust Proxy (required for Railway / reverse proxies) ─────────────────────
// Without this, req.protocol returns 'http' even behind Railway's HTTPS proxy.
app.set('trust proxy', 1);

// ─── Global Template Locals ───────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentUser = null;
  res.locals.appName = process.env.APP_NAME || 'Maths Manthra';

  // ── Single source of truth for the base URL ──────────────────────────────
  // Priority:
  //   1. APP_URL env var (set in Railway dashboard / .env for custom domains)
  //   2. Derived from the current request host (works for any environment)
  // Strip trailing slash so we can always append /course/slug safely.
  const rawUrl =
    process.env.APP_URL ||
    `${req.protocol}://${req.get('host')}`;

  res.locals.appUrl = rawUrl.replace(/\/$/, '');

  next();
});

// ─── Global Template Helpers ──────────────────────────────────────────────────
// Define these once on app.locals so they are available to all EJS templates,
// even if a route errors out before the middleware completes or if res.locals is reset.
app.locals.formatDate = formatDate;
app.locals.timeAgo = timeAgo;
app.locals.truncate = truncate;


// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth.routes'));
app.use('/admin', require('./routes/admin.routes'));

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
