/**
 * scripts/seed.js
 * Database seeder — creates admin user + sample courses with passwords + videos.
 * Run: npm run seed
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Course = require('../models/Course');
const Video = require('../models/Video');
const connectDB = require('../config/db');

const seed = async () => {
  await connectDB();
  console.log('\n🌱 Seeding Maths Manthra database...\n');

  // Clear existing data
  await Promise.all([
    User.deleteMany({}),
    Course.deleteMany({}),
    Video.deleteMany({}),
  ]);
  console.log('🗑️  Cleared existing data');

  // ── Create Super Admin ───────────────────────────────────────
  const admin = await User.create({
    name: 'Admin User',
    email: 'admin@mathsmantras.com',
    password: 'Admin@123',
    role: 'superadmin',
    status: 'active',
  });
  console.log(`✅ Admin created: ${admin.email} / Admin@123`);

  // ── Create Courses ───────────────────────────────────────────
  const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;

  const course1 = await Course.create({
    title: 'Class 10 Mathematics - Night Batch',
    description: 'Complete NCERT-based mathematics course for Class 10 students. Night batch covering all chapters with detailed explanations.',
    passwordHash: await bcrypt.hash('4587', rounds),
    isActive: true,
  });

  const course2 = await Course.create({
    title: 'Class 12 Mathematics - Day Batch',
    description: 'Advanced mathematics for Class 12 covering Calculus, Vectors, 3D Geometry, and more. Board exam focused.',
    passwordHash: await bcrypt.hash('1234', rounds),
    isActive: true,
  });

  const course3 = await Course.create({
    title: 'Abacus Level 1',
    description: 'Foundation course for mental arithmetic using the abacus method.',
    passwordHash: await bcrypt.hash('9999', rounds),
    isActive: false,
  });

  console.log(`✅ 3 courses created`);

  // ── Create Videos ───────────────────────────────────────────
  // NOTE: dQw4w9WgXcQ is a placeholder video ID. Replace with real unlisted video IDs.
  await Video.create([
    {
      courseId: course1._id, dayNumber: 1, title: 'Introduction to Real Numbers',
      description: 'Introduction to the concept of real numbers, rational and irrational numbers.',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', order: 0,
    },
    {
      courseId: course1._id, dayNumber: 2, title: 'Euclid\'s Division Lemma',
      description: 'Understanding Euclid\'s Division Lemma and its applications.',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', order: 1,
    },
    {
      courseId: course1._id, dayNumber: 3, title: 'Exercise Discussion',
      description: 'Solving NCERT exercises from Chapter 1.',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', order: 2,
    },
    {
      courseId: course1._id, dayNumber: 4, title: 'Homework Review',
      description: 'Reviewing homework problems and common mistakes.',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', order: 3,
    },
    {
      courseId: course1._id, dayNumber: 5, title: 'Polynomials Introduction',
      description: 'Types of polynomials, degree, and coefficients.',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', order: 4,
    },
    {
      courseId: course2._id, dayNumber: 1, title: 'Relations and Functions',
      description: 'Domain, range, types of relations and functions.',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', order: 0,
    },
    {
      courseId: course2._id, dayNumber: 2, title: 'Inverse Trigonometric Functions',
      description: 'Definition, domain, range, and graphs of inverse trig functions.',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', order: 1,
    },
    {
      courseId: course2._id, dayNumber: 3, title: 'Matrices Introduction',
      description: 'Types of matrices, operations, and properties.',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', order: 2,
    },
  ]);
  console.log(`✅ 8 videos created`);

  console.log('\n🎉 Database seeded successfully!\n');
  console.log('─────────────────────────────────────────');
  console.log('  Admin Login:');
  console.log('  Email    : admin@mathsmantras.com');
  console.log('  Password : Admin@123');
  console.log('─────────────────────────────────────────');
  console.log('  Sample Course Passwords:');
  console.log('  Night Batch : 4587');
  console.log('  Day Batch   : 1234');
  console.log('  Abacus      : 9999 (inactive)');
  console.log('─────────────────────────────────────────\n');

  process.exit(0);
};

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
