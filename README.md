# 📐 Maths Mantras LMS

> A production-ready Learning Management System for recorded mathematics classes.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- MongoDB 6+ (local or [MongoDB Atlas](https://cloud.mongodb.com))

### 1. Clone & Install

```bash
cd "maths_manthra_recorded page"
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
NODE_ENV=development
PORT=3000
MONGO_URI=mongodb://localhost:27017/maths_mantras
JWT_SECRET=your_very_secret_key_here
SESSION_SECRET=your_session_secret_here
APP_URL=http://localhost:3000
```

### 3. Seed the Database

```bash
npm run seed
```

This creates:
- **Admin**: `admin@mathsmantras.com` / `Admin@123`
- **Student**: `priya@example.com` / `Student@123`
- 2 courses, 5 chapters, 8 sample lessons

### 4. Start the Server

```bash
npm start          # production
npm run dev        # development (with nodemon auto-reload)
```

Visit: **http://localhost:3000**

---

## 🐳 Docker Deployment

```bash
# Copy and configure env
cp .env.example .env

# Build and run
docker-compose up -d

# Seed the database
docker exec maths_mantras_app node scripts/seed.js

# View logs
docker-compose logs -f app
```

---

## 📁 Project Structure

```
maths-mantras/
├── config/          # Database connection
├── controllers/     # Route handlers
│   ├── admin/       # Admin CRUD controllers
│   └── student/     # Student controllers
├── middleware/      # Auth, roles, uploads, errors
├── models/          # Mongoose schemas
├── public/          # Static assets
│   ├── css/         # main.css, admin.css, player.css
│   └── js/          # main.js, admin.js, player.js
├── routes/          # Express routers
├── scripts/         # seed.js
├── utils/           # youtube.js, email.js, helpers.js
├── views/           # EJS templates
│   ├── admin/       # Admin dashboard pages
│   ├── auth/        # Login, register, password reset
│   ├── layouts/     # main, admin, student layouts
│   ├── partials/    # Reusable components
│   └── student/     # Student dashboard pages
├── app.js           # Express app setup
├── server.js        # Entry point
├── Dockerfile
└── docker-compose.yml
```

---

## 👤 User Roles

| Role | Access | Login URL |
|------|--------|-----------|
| Super Admin | Full admin dashboard, content management | `/auth/login` |
| Student | Course browsing, video player, progress tracking | `/auth/login` |

---

## 🎬 Adding Video Lessons (Admin Workflow)

1. Record class and upload to **YouTube as Unlisted**
2. Log in to admin: `/auth/login`
3. Go to **Lessons → Add Lesson**
4. Paste the full YouTube URL (e.g. `https://youtube.com/watch?v=xxxxx`)
5. The system **automatically extracts the Video ID** server-side
6. Set status to **Published** when ready

> **Security**: Students never see the YouTube URL. The video is embedded via `youtube-nocookie.com` iframe only.

---

## 🔒 Security Features

| Feature | Implementation |
|---------|----------------|
| Password Hashing | bcryptjs (12 rounds) |
| Authentication | JWT in HTTP-only cookie |
| XSS Protection | xss-clean middleware |
| NoSQL Injection | express-mongo-sanitize |
| Rate Limiting | express-rate-limit (50 req/15min on auth routes) |
| Security Headers | Helmet.js with custom CSP |
| Content Protection | Right-click disable, keyboard shortcut blocking, student watermark |

> ⚠️ **Note**: Client-side content protection is a deterrent only. Screen recording and network inspection tools can still capture video content. For stronger protection, use a self-hosted video streaming service.

---

## 🎨 Design

- **Font**: Poppins (Google Fonts)
- **Primary**: `#1E40AF` | **Secondary**: `#2563EB` | **Accent**: `#F59E0B`
- **Bootstrap 5.3** + Custom CSS design tokens
- **Dark Mode** toggle with localStorage persistence
- **Fully Responsive**: 320px → 1440px+

---

## 🌐 Production Deployment

### Environment Variables (Required)

```env
NODE_ENV=production
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/maths_mantras
JWT_SECRET=<64+ random chars>
SESSION_SECRET=<64+ random chars>
APP_URL=https://yourdomain.com
```

### Recommended Stack
- **App Server**: PM2 on VPS / Railway / Render / Heroku
- **Database**: MongoDB Atlas (free tier available)
- **Reverse Proxy**: Nginx
- **SSL**: Let's Encrypt / Cloudflare

### PM2 (Process Manager)
```bash
npm install -g pm2
pm2 start server.js --name maths-mantras
pm2 save
pm2 startup
```

---

## 📧 Email Configuration (Optional)

For password reset emails, configure SMTP in `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=your_app_password   # Gmail App Password
```

Without SMTP config, reset emails are logged to console (development mode).

---

## 🧪 Sample Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@mathsmantras.com | Admin@123 |
| Student | priya@example.com | Student@123 |

---

## 📄 License

ISC License — © 2024 Maths Mantras
