# 📐 Maths Manthra — Private Recorded Classes & Academic Verification LMS

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express-4.19.2-blue.svg)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose_8+-brightgreen.svg)](https://www.mongodb.com/)
[![TailwindCSS & Bootstrap](https://img.shields.io/badge/UI-TailwindCSS%20%7C%20Bootstrap%205.3-purple.svg)](https://tailwindcss.com/)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

> **Maths Manthra** is an all-in-one institutional web platform built for high-security, password-protected recorded mathematics class sharing, tamper-proof student certificate generation and verification, automated student performance evaluation reporting, and bulk academic data administration.

---

## 📑 Table of Contents

- [Overview & Architecture](#-overview--architecture)
- [Key Features](#-key-features)
  - [1. Password-Protected Course & Video Delivery](#1-password-protected-course--video-delivery)
  - [2. Certificate Issuance & Verification Portal](#2-certificate-issuance--verification-portal)
  - [3. Student Performance Evaluation (Scores Portal)](#3-student-performance-evaluation-scores-portal)
  - [4. Secure OTP Email Verification](#4-secure-otp-email-verification)
  - [5. Administrative Control Panel](#5-administrative-control-panel)
  - [6. Anti-Piracy & Content Deterrence](#6-anti-piracy--content-deterrence)
- [Tech Stack](#-tech-stack)
- [Project Directory Structure](#-project-directory-structure)
- [Prerequisites & Requirements](#-prerequisites--requirements)
- [Step-by-Step Installation & Local Setup](#-step-by-step-installation--local-setup)
- [Environment Variables Guide](#-environment-variables-guide)
- [Database Seeding & Default Credentials](#-database-seeding--default-credentials)
- [Application Routes & Endpoints](#-application-routes--endpoints)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Docker & Containerized Deployment](#-docker--containerized-deployment)
- [Production Deployment Guide](#-production-deployment-guide)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [License](#-license)

---

## 🎯 Overview & Architecture

Maths Manthra is engineered with a **frictionless student access model**:
- **Zero Student Account Friction**: Students do **not** need to register accounts or manage usernames/passwords to watch their enrolled recorded classes. Instead, courses are protected via individual course passcode keys stored in signed, tamper-resistant HTTP cookies.
- **Self-Serve Academic Verification**: Students and parents can access official academic certificates and performance evaluation reports using their registered email through a secure, rate-limited One-Time Password (OTP) system.
- **Public Verification Directory**: Anyone (institutions, employers, parents) can verify certificate authenticity via public verification links (`/verify/:studentId`) or QR codes.
- **Admin Management Hub**: Instructors and administrators have a dedicated, JWT-authenticated dashboard to organize courses, manage YouTube video metadata, batch upload student records via Excel (`.xlsx`), and generate PDF certificates via Puppeteer/PDFKit.

```
                     ┌──────────────────────────────────────────────┐
                     │                Maths Manthra                 │
                     │          Express & EJS Application           │
                     └──────────────────────┬───────────────────────┘
                                            │
        ┌───────────────────────────────────┼────────────────────────────────────┐
        ▼                                   ▼                                    ▼
┌──────────────────┐               ┌──────────────────┐                ┌──────────────────┐
│  Course Portal   │               │ Certificate &    │                │  Admin Console   │
│  & Video Player  │               │ Evaluation Score │                │  (Management)    │
└────────┬─────────┘               └────────┬─────────┘                └────────┬─────────┘
         │                                  │                                   │
  Password Gate                      Email OTP Gate                      JWT Authentication
  Signed Cookies                    Nodemailer + OTP                    Role: superadmin
  YouTube Privacy Guard             Puppeteer / PDFKit                  Excel Bulk Imports
```

---

## ✨ Key Features

### 1. Password-Protected Course & Video Delivery
- **Course Passwords**: Each course has an independently configurable passcode (hashed via `bcryptjs`).
- **Cryptographically Signed Cookies**: Upon successful password entry, students receive a signed HTTP-only cookie granting access to videos within that course for a customizable duration (default 7 days).
- **YouTube Embed Protection**: Embedded via `youtube-nocookie.com`. Video IDs are dynamically handled server-side, keeping source playlists and direct links shielded.
- **Custom Player & Navigation**: Full responsive video player with chapter lists, next/previous video navigation, and playback speed controls.

### 2. Certificate Issuance & Verification Portal
- **Unique Student ID & Certificate ID**: Generates structured, unique student IDs (`MM-YYYY-XXXX`) and certificate identifiers with auto-incrementing counters.
- **Public Verification & QR Codes**: Dynamic QR codes rendered on certificates point directly to `/verify/:studentId` for instantaneous real-time authenticity validation.
- **High-Fidelity PDF Generation**: Powered by Puppeteer and custom EJS/CSS templates, generating print-ready, professional landscape certificates.
- **Downloadable & Shareable**: Instant PDF downloads and OpenGraph previews for social sharing.

### 3. Student Performance Evaluation (Scores Portal)
- **Academic Scorecard**: Displays test results, term evaluations, marks breakdown, grades, attendance, and faculty feedback (`/scores`).
- **Support for Special Cohorts**: Accommodates standard certificates as well as specialised study programs (e.g. Study Days cohorts).

### 4. Secure OTP Email Verification
- **Email Authentication**: Passwordless student login for downloading certificates and viewing scorecards.
- **Rate-Limited OTPs**: Strict IP and session-based rate limiters (maximum 5 OTP requests and 10 verification attempts per hour) to eliminate brute-force and email flooding risks.
- **Nodemailer Integration**: Compatible with standard SMTP services (Gmail, SendGrid, Amazon SES, Brevo) with a built-in development fallback that logs OTPs directly to stdout/console.

### 5. Administrative Control Panel
- **Course Management**: Create, edit, toggle active status, change passwords, and regenerate URL slugs.
- **Video Management**: Link unlisted YouTube videos, edit metadata, configure display orders, and organize course video catalogs.
- **Bulk Excel Import**: Ingest dozens or hundreds of student records, certificates, and grades simultaneously with `.xlsx` spreadsheet uploads using automated column parsing and validation.
- **Student Record Editor**: Individually create, edit, search, paginate, and revoke student credentials and certificates.

### 6. Anti-Piracy & Content Deterrence
- **Client-Side Deterrents**: Right-click context menu prevention, developer shortcut restrictions (`F12`, `Ctrl+Shift+I`, etc.), and text selection disabling on sensitive pages.
- **Dynamic Watermarking**: Embeds dynamic student identifiers across video player and verification views to discourage screen recording.
- **Security Headers**: Strict Content Security Policy (CSP), anti-clickjacking (`X-Frame-Options`), and cross-site scripting filters enforced by `helmet`.

---

## 🛠 Tech Stack

| Domain | Technology / Library | Purpose |
|---|---|---|
| **Runtime** | Node.js (>= 18.0.0) | High-performance asynchronous backend execution |
| **Framework** | Express 4.19 | Web application framework and REST routing |
| **Database** | MongoDB & Mongoose 8+ | Document store for users, courses, videos, certificates, and OTPs |
| **Session & State** | `connect-mongo`, `express-session`, `cookie-parser` | Persistent distributed session store & signed cookies |
| **Templating** | EJS & `express-ejs-layouts` | Dynamic server-side UI rendering with partials and layouts |
| **Styling** | Tailwind CSS & Bootstrap 5.3 | Modern, responsive interface with custom theme tokens |
| **PDF Generation** | Puppeteer & PDFKit | Server-side browser rendering for pixel-perfect certificate PDFs |
| **File Processing** | Multer, Multer Storage Cloudinary, SheetJS (`xlsx`) | Media file uploads and Excel spreadsheet ingestion |
| **Security** | Helmet, `express-mongo-sanitize`, `xss-clean`, `express-rate-limit`, `bcryptjs` | Multi-layered defense against XSS, injection, brute-forcing, and CORS exploits |
| **Testing** | Playwright (`@playwright/test`) | Comprehensive end-to-end and integration test suites |

---

## 📂 Project Directory Structure

```
maths_manthra_recordings/
├── api/                     # Serverless execution adapter (Vercel)
├── config/
│   ├── db.js                # MongoDB connection handler with retry logic
│   └── ...
├── controllers/
│   ├── admin/
│   │   ├── certificate.controller.js  # Admin student & certificate CRUD, bulk imports
│   │   ├── course.controller.js       # Admin course management
│   │   ├── dashboard.controller.js    # Metric aggregation for admin dashboard
│   │   └── video.controller.js        # Video CRUD and sequence reordering
│   ├── auth.controller.js             # Superadmin authentication & login
│   ├── certificate.controller.js      # Public certificate search, OTP, and PDF export
│   ├── course.controller.js           # Password gate, signed cookie issuer, video viewing
│   ├── scores.controller.js           # Student evaluation & scorecard viewing
│   └── verify.controller.js           # Public certificate & student authenticity check
├── middleware/
│   ├── auth.middleware.js             # JWT verification & signed course cookie verification
│   ├── error.middleware.js            # Standardized 404 & 500 error handlers
│   └── upload.middleware.js           # Multer configuration for images & Excel files
├── models/
│   ├── CertificateStudent.js          # Student academic records, marks, and certificate metadata
│   ├── Counter.js                     # Atomic sequence counter for serial certificate IDs
│   ├── Course.js                      # Course models, slug generation, bcrypt password hashes
│   ├── EmailOTP.js                    # Transient email verification tokens with TTL expiration
│   ├── User.js                        # Admin user credentials and roles
│   └── Video.js                       # Video lesson entries, YouTube metadata, ordering
├── public/
│   ├── css/                           # Compiled CSS, design tokens, certificate styling
│   ├── images/                        # Branding logos, badges, and template watermarks
│   └── js/                            # Client-side validation, UI interactivity, player controls
├── routes/
│   ├── admin.routes.js                # Protected /admin/* routes
│   ├── auth.routes.js                 # Authentication /auth/* routes
│   └── index.js                       # Public routes (/verify, /course, /certificate, /scores)
├── scripts/
│   ├── measure_template.js            # Geometry calibration script for certificate layout
│   ├── playwright_audit.js            # Automated accessibility and layout audits
│   ├── seed.js                        # Database initialization and sample data seeder
│   └── test_pdf_render.js             # PDF generation test harness
├── services/
│   └── email.service.js               # Nodemailer transport, HTML email templates, OTP dispatcher
├── tests/
│   ├── deployment_checks.test.js      # Production deployment sanity check test suite
│   ├── scores_feature.test.js         # End-to-end testing for scores and OTP workflow
│   └── video_crud_hardening.test.js   # Automated test suite for video administration
├── utils/
│   ├── helpers.js                     # Template string formatting, dates, text truncation
│   ├── pagination.js                  # Query paginator utility
│   └── youtube.js                     # YouTube URL parser and Video ID extractor
├── views/
│   ├── admin/                         # Admin view templates (courses, videos, certificates)
│   ├── auth/                          # Login and authentication forms
│   ├── course/                        # Video player, course videos catalog, password gate
│   ├── layouts/                       # Base layouts (main, admin, student)
│   ├── partials/                      # Headers, footers, alerts, sidebars
│   ├── 404.ejs                        # Custom 404 Not Found page
│   ├── error.ejs                      # Custom 500 Server Error page
│   └── verify.ejs                     # Public student certificate validation template
├── app.js                             # Express application initialization and middleware
├── server.js                          # HTTP server entrypoint
├── Dockerfile                         # Container build recipe
├── docker-compose.yml                 # Multi-container orchestration (App + MongoDB)
├── package.json                       # Project manifests, scripts, dependencies
└── vercel.json                        # Vercel serverless deployment configuration
```

---

## ⚙️ Prerequisites & Requirements

Before setting up the project locally or on a server, ensure you have:
- **Node.js**: `v18.0.0` or higher (LTS recommended)
- **npm**: `v9.0.0` or higher
- **MongoDB**: Local MongoDB instance (`v6.0+`) or a free [MongoDB Atlas](https://cloud.mongodb.com) cluster
- **Chromium / Browser Dependencies** (if generating PDFs locally or running Playwright tests):
  - On Ubuntu/Debian: `sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2`
  - On macOS: Built-in system graphics drivers are sufficient

---

## 🚀 Step-by-Step Installation & Local Setup

### 1. Clone Repository & Install Dependencies

```bash
# Clone the repository
git clone https://github.com/your-username/maths_manthra_recordings.git
cd maths_manthra_recordings

# Install all npm dependencies
npm install
```

### 2. Configure Environment Variables

Create a local environment file from the provided template:

```bash
cp .env.example .env
```

Open `.env` in your editor and configure the essential parameters:

```env
NODE_ENV=development
PORT=3000
APP_NAME="Maths Manthra"

# Local MongoDB or your MongoDB Atlas URI
MONGO_URI=mongodb://localhost:27017/maths_mantras

# Strong random secret keys
JWT_SECRET=generate_a_long_random_jwt_secret_key_32_chars_min
SESSION_SECRET=generate_a_long_random_session_secret_key_32_chars_min
COOKIE_SECRET=generate_a_long_random_cookie_secret_key_32_chars_min

# Email Configuration (Optional for local testing; logs OTP to console if blank)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password
EMAIL_FROM="Maths Manthra <noreply@mathsmantras.com>"
```

### 3. Seed Database with Starter Data

Initialize admin accounts, sample courses, passcodes, and lessons:

```bash
npm run seed
```

### 4. Start the Application

```bash
# Development mode with hot-reloading (nodemon)
npm run dev

# Or standard production start
npm start
```

Visit **http://localhost:3000** in your web browser. You will be automatically redirected to the admin login portal (`/auth/login`).

---

## 🔑 Environment Variables Guide

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Set to `production` in live environments to enforce HTTPS cookies. |
| `PORT` | No | `3000` | Port on which the HTTP server listens. |
| `APP_NAME` | No | `Maths Manthra` | Global application title rendered in headers, emails, and page titles. |
| `APP_URL` | No | Auto-detected | Base URL of the deployed application (leave blank to auto-detect from request headers). |
| `MONGO_URI` / `MONGODB_URI` | Yes | — | MongoDB connection string (supports `mongodb://` and `mongodb+srv://`). |
| `JWT_SECRET` | Yes | — | Secret key used to sign and verify admin JSON Web Tokens. |
| `JWT_EXPIRES_IN` | No | `7d` | Admin token validity duration. |
| `SESSION_SECRET` | Yes | — | Secret string used to sign session cookies. |
| `SESSION_EXPIRES_IN` | No | `86400000` | Session duration in milliseconds (1 day = 86400000 ms). |
| `COOKIE_SECRET` | Recommended | — | Dedicated secret for signing course access cookies. Falls back to `SESSION_SECRET`. |
| `COOKIE_MAX_AGE` | No | `604800000` | Duration of course access cookies in ms (7 days = 604800000 ms). |
| `BCRYPT_ROUNDS` | No | `12` | Salt rounds for hashing admin passwords and course passwords. |
| `SMTP_HOST` | No | — | Outgoing SMTP server address (e.g. `smtp.gmail.com`, `smtp.sendgrid.net`). |
| `SMTP_PORT` | No | `587` | Outgoing SMTP server port (`587` for TLS, `465` for SSL). |
| `SMTP_SECURE` | No | `false` | `true` for port 465, `false` for port 587. |
| `SMTP_USER` | No | — | Username or email for authenticating with the SMTP host. |
| `SMTP_PASS` | No | — | Password or application-specific password for SMTP. |
| `EMAIL_FROM` | No | — | Sender name and address for transactional emails. |
| `CLOUDINARY_CLOUD_NAME` | Optional | — | Cloudinary cloud identifier for media asset uploads. |
| `CLOUDINARY_API_KEY` | Optional | — | Cloudinary API Key. |
| `CLOUDINARY_API_SECRET` | Optional | — | Cloudinary API Secret. |

> 💡 **Tip**: If `SMTP_HOST` is left unset, OTPs and verification tokens will automatically print directly in your server terminal for convenient local development and debugging!

---

## 👤 Database Seeding & Default Credentials

Running `npm run seed` creates the following baseline dataset:

### Super Admin Credentials
- **Login URL**: `/auth/login`
- **Email**: `admin@mathsmantras.com`
- **Password**: `Admin@123`
- **Role**: `superadmin`

### Default Courses & Passwords

| Course Title | URL Path | Passcode | Status |
|---|---|---|---|
| **Class 10 Mathematics - Night Session** | `/course/class-10-mathematics-night-session` | `4587` | Active |
| **Class 12 Mathematics - Day Session** | `/course/class-12-mathematics-day-session` | `1234` | Active |
| **Abacus Level 1** | `/course/abacus-level-1` | `9999` | Inactive |

---

## 🚦 Application Routes & Endpoints

### 1. Public & Student Portal Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Redirects to `/auth/login` |
| `GET` | `/verify` | Search portal for public certificate validation |
| `GET` | `/verify/:studentId` | Public validation badge and academic summary for verified students |
| `GET` | `/certificate` | Self-serve student certificate portal |
| `POST` | `/certificate/send-otp` | Request a login OTP sent to the student's email |
| `POST` | `/certificate/verify-otp` | Verify OTP code and establish student certificate session |
| `GET` | `/certificate/download/:id` | Generates and streams print-ready certificate PDF |
| `GET` | `/scores` | Student performance evaluation and marks portal |
| `POST` | `/scores/send-otp` | Request OTP for accessing academic scores |
| `POST` | `/scores/verify-otp` | Validate OTP and load academic performance report |
| `GET` | `/course/:slug` | Course passcode gate |
| `POST` | `/course/:slug/verify` | Submit passcode; issues signed cookie on success |
| `GET` | `/course/:slug/watch` | Course video index *(Requires valid course cookie)* |
| `GET` | `/course/:slug/watch/:videoId` | Course video player view *(Requires valid course cookie)* |

### 2. Admin Authentication Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/login` | Renders admin authentication login page |
| `POST` | `/auth/login` | Validates credentials; sets HTTP-only JWT cookie |
| `GET` | `/auth/logout` | Clears authentication tokens and redirects to login |

### 3. Protected Admin Routes (`/admin/*`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/dashboard` | Main metrics overview (total courses, videos, certificates, active batches) |
| `GET` | `/admin/courses` | List all courses with search, filtering, and pagination |
| `POST` | `/admin/courses` | Create a new course with title, description, and passcode |
| `POST` | `/admin/courses/:id` | Update existing course details or regenerate access passcode |
| `POST` | `/admin/courses/:id/toggle-active` | Instantly activate or archive a course |
| `POST` | `/admin/courses/:id/delete` | Permanently remove a course |
| `GET` | `/admin/videos` | Video inventory and course filter |
| `POST` | `/admin/videos/create` | Add video lesson with YouTube URL auto-extraction |
| `POST` | `/admin/videos/reorder` | Batch update sequencing order of lessons |
| `POST` | `/admin/videos/:id/delete` | Remove video lesson |
| `GET` | `/admin/certificates` | Manage issued certificates and registered student records |
| `GET` | `/admin/certificates/upload` | View Excel upload interface for batch imports |
| `POST` | `/admin/certificates/upload` | Process `.xlsx` file upload and import student records |
| `POST` | `/admin/certificates/create` | Manually register a single certificate and student record |
| `POST` | `/admin/certificates/:id/delete` | Delete or revoke student certificate |

---

## 🧪 Testing & Quality Assurance

The codebase includes end-to-end tests built using Playwright:

```bash
# Run all deployment sanity checks and test suites
npx playwright test

# Run specific test suites
npx playwright test tests/deployment_checks.test.js
npx playwright test tests/scores_feature.test.js
npx playwright test tests/video_crud_hardening.test.js

# Run test in headed mode (visible browser window)
npx playwright test --headed
```

### Pre-Deployment Verification Checklist
- Run `npm test` or playwright test scripts.
- Ensure all environment variables in `.env` are populated.
- Test OTP delivery using a valid test email address.
- Verify that YouTube video embeds load with audio and video controls intact.

---

## 🐳 Docker & Containerized Deployment

You can run the entire platform including MongoDB using Docker Compose:

### 1. Build and Run Containers

```bash
# Build images and start containers in the background
docker-compose up -d --build
```

### 2. Run Database Migrations/Seeds Inside the Container

```bash
docker exec -it maths_mantras_app node scripts/seed.js
```

### 3. Monitor Logs & Manage

```bash
# View real-time logs from application
docker-compose logs -f app

# Stop containers
docker-compose down
```

---

## 🌐 Production Deployment Guide

### Deploying to Railway or Render

1. **Connect Repository**: Link your GitHub repository in your Railway or Render dashboard.
2. **Environment Variables**: Add all mandatory environment variables (`MONGO_URI`, `JWT_SECRET`, `SESSION_SECRET`, `COOKIE_SECRET`, `NODE_ENV=production`).
3. **Build Command**: `npm install`
4. **Start Command**: `npm start`
5. **Reverse Proxy & Trust Proxy**: The application automatically configures `app.set('trust proxy', 1)`, guaranteeing correct handling of `req.protocol` and secure cookie flags when behind HTTPS reverse proxies.

### Deploying to a Linux VPS (Ubuntu / Debian with PM2 & Nginx)

1. **Install Node.js 18+ and PM2**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx
   sudo npm install -g pm2
   ```

2. **Clone & Setup**:
   ```bash
   cd /var/www
   git clone <repo-url> maths_manthra
   cd maths_manthra
   npm install --production
   cp .env.example .env
   # Edit .env with production credentials
   ```

3. **Start with PM2**:
   ```bash
   pm2 start server.js --name "maths-manthra"
   pm2 save
   pm2 startup
   ```

4. **Nginx Reverse Proxy Configuration**:
   ```nginx
   server {
       server_name yourdomain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
5. **Enable HTTPS**: Obtain a free SSL certificate with Let's Encrypt:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com
   ```

---

## ❓ Troubleshooting & FAQ

### 1. YouTube videos are not playing or showing "Video Unavailable"
- Confirm that the video privacy setting on YouTube is set to **Unlisted** (not Private).
- Verify that your domain or `localhost` is not blocked by YouTube content embed restrictions.
- Ensure `youtube-nocookie.com` and `youtube.com` are permitted in your Helmet Content Security Policy directives in `app.js`.

### 2. Cookies are not persisting or students keep seeing the password prompt
- In production, cookies are flagged with `secure: true`. Make sure you are accessing the site via `https://` or have properly configured reverse proxy headers (`X-Forwarded-Proto`).
- In local testing (`http://localhost:3000`), ensure `NODE_ENV` is set to `development` so that non-HTTPS cookies are accepted by your browser.

### 3. PDF Generation fails with `Puppeteer launch error`
- Ensure all required Linux libraries (`libnss3`, `libasound2`, `libgbm1`, etc.) are installed on your host machine or container.
- When deploying in constrained Docker or VPS environments, ensure `--no-sandbox` and `--disable-setuid-sandbox` args are supplied in Puppeteer launch configurations.

### 4. Emails or OTPs are not arriving
- Check if `SMTP_HOST` is defined in `.env`. If it is blank, OTP codes are printed directly to the terminal stdout.
- If using Gmail SMTP, generate an **App Password** from Google Account Security settings; standard account passwords will fail due to 2FA requirements.

---

## 📄 License

This project is licensed under the [ISC License](file:///Users/jeebs/Library/Mobile%20Documents/com~apple~CloudDocs/maths_manthra_recordings-main/package.json).

&copy; 2024–2026 **Maths Manthra Team**. All rights reserved.
