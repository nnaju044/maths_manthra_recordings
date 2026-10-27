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
const compression = require('compression');

const app = express();
app.use(compression());



// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'www.youtube.com', 'www.youtube-nocookie.com', 'cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'img.youtube.com',
        'i.ytimg.com',
        '*.ytimg.com',
        'res.cloudinary.com',
        '*.cloudinary.com',
        'drive.google.com',
        '*.googleusercontent.com',
        '*.google.com',
        'https:',
      ],
      frameSrc: ["'self'", 'www.youtube-nocookie.com', 'www.youtube.com'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
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

// ─── Cookie Parser ────────────────────────────────────────────────────────────
// In serverless environments (e.g. Vercel via @vercel/node), req.cookies is pre-populated
// before reaching Express. This causes cookie-parser to exit early without setting req.secret
// or populating req.signedCookies. Deleting req.cookies beforehand allows cookie-parser to
// parse cookies from headers, verify signatures, populate req.signedCookies, and set req.secret.
app.use((req, res, next) => {
  if (req.cookies && !req.secret) {
    delete req.cookies;
  }
  next();
});

// Resolve cookie signing secret:
// 1. COOKIE_SECRET (primary)
// 2. SESSION_SECRET (secure fallback if configured)
// 3. In development/test: development secret
// 4. In production: if missing, warn and generate secure runtime secret to prevent crashes,
//    while instructing configuration in Vercel Project Settings.
let cookieSecret = (process.env.COOKIE_SECRET || process.env.SESSION_SECRET || '').trim();

if (!cookieSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️  [Security] COOKIE_SECRET is not configured in environment variables. Please set COOKIE_SECRET under Project Settings → Environment Variables in Vercel.');
    const crypto = require('crypto');
    cookieSecret = crypto.randomBytes(32).toString('hex');
  } else {
    cookieSecret = 'maths-manthra-dev-cookie-secret';
  }
}

app.use(cookieParser(cookieSecret));

// Guarantee req.secret is always populated on the request object for res.cookie({ signed: true })
app.use((req, res, next) => {
  if (!req.secret) {
    req.secret = cookieSecret;
  }
  next();
});

// ─── Session (for connect-flash) ──────────────────────────────────────────────
const rawUri = (process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || '').trim();
const mongoUri = (rawUri.startsWith('mongodb://') || rawUri.startsWith('mongodb+srv://')) ? rawUri : null;

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'maths-manthra-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: parseInt(process.env.SESSION_EXPIRES_IN) || 86400000,
  },
};

if (mongoUri) {
  sessionConfig.store = MongoStore.create({ mongoUrl: mongoUri, ttl: 24 * 60 * 60 });
} else {
  console.warn('⚠️  [Session] MONGO_URI / MONGODB_URI is not defined or invalid. Falling back to in-memory session store.');
}

app.use(session(sessionConfig));

// Debug session logging for certificate verification audit
app.use('/certificate', (req, res, next) => {
  console.log('SESSION ID:', req.sessionID);
  console.log('SESSION DATA:', req.session);
  next();
});

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

  // ── Always derive base URL from the live request ─────────────────────────
  // req.protocol is 'https' behind Railway thanks to `trust proxy` above.
  // This means no APP_URL env var is ever needed — the correct domain is
  // automatically picked up in every environment (local, staging, Railway).
  res.locals.appUrl = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');

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
