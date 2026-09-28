/**
 * models/CertificateStudent.js
 * Student details associated with an issued course certificate.
 */
const mongoose = require('mongoose');
require('./Course'); // Ensure Course model is registered for populate('courseId')

const certificateStudentSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Student full name is required'],
      trim: true,
    },
    // Maintained for backward compatibility
    name: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Student email is required'],
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    qualification: {
      type: String,
      trim: true,
    },
    profileImage: {
      type: String,
      trim: true,
    },
    marks: {
      type: Number,
      default: 0,
    },
    progressCard: {
      type: String,
      default: '',
      trim: true,
    },
    studentId: {
      type: String,
      trim: true,
    },
    verificationStatus: {
      type: Boolean,
      default: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: [true, 'Course is required'],
    },
    certificateNumber: {
      type: String,
      unique: true,
      trim: true,
    },
    issuedDate: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // --- WEEKLY PERFORMANCE ---
    week1: {
      classPerformance: { type: String, default: '', trim: true },
      assignmentHomework: { type: String, default: '', trim: true },
      activityEngagement: { type: String, default: '', trim: true },
      weeklyMark: { type: Number, default: 0 },
    },
    week2: {
      classPerformance: { type: String, default: '', trim: true },
      assignmentHomework: { type: String, default: '', trim: true },
      activityEngagement: { type: String, default: '', trim: true },
      weeklyMark: { type: Number, default: 0 },
    },
    week3: {
      classPerformance: { type: String, default: '', trim: true },
      assignmentHomework: { type: String, default: '', trim: true },
      activityEngagement: { type: String, default: '', trim: true },
      weeklyMark: { type: Number, default: 0 },
    },
    week4: {
      classPerformance: { type: String, default: '', trim: true },
      assignmentHomework: { type: String, default: '', trim: true },
      activityEngagement: { type: String, default: '', trim: true },
      weeklyMark: { type: Number, default: 0 },
    },

    // --- FINAL ASSESSMENT ---
    internalMark: { type: Number, default: 0 },
    theoryMark: { type: Number, default: 0 },
    practicalMark: { type: Number, default: 0 },
    totalMark: { type: Number, default: 0 },

    // --- OVERALL PROGRESS ---
    academicPerformance: { type: String, default: '', trim: true },
    assignmentCompletion: { type: String, default: '', trim: true },
    practicalSkills: { type: String, default: '', trim: true },
    overallProgress: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

// Synchronize fullName and name
certificateStudentSchema.pre('save', function (next) {
  if (this.fullName && !this.name) {
    this.name = this.fullName;
  } else if (this.name && !this.fullName) {
    this.fullName = this.name;
  }
  next();
});

certificateStudentSchema.index({ courseId: 1, issuedDate: -1 });
certificateStudentSchema.index({ email: 1, courseId: 1 });
certificateStudentSchema.index({ studentId: 1 }, { unique: true, sparse: true });
certificateStudentSchema.index({ certificateNumber: 1, isActive: 1 });

/**
 * Static method to find an active student record by studentId, certificateNumber, or _id
 * Supports trimmed exact and case-insensitive matching
 */
certificateStudentSchema.statics.findActiveByIdentifier = function (identifier) {
  if (!identifier || typeof identifier !== 'string') return Promise.resolve(null);
  const clean = identifier.trim();
  if (!clean) return Promise.resolve(null);

  const orQueries = [
    { studentId: clean },
    { studentId: clean.toUpperCase() },
    { certificateNumber: clean },
    { certificateNumber: clean.toUpperCase() },
    { certificateNumber: clean.toLowerCase() },
  ];

  if (mongoose.Types.ObjectId.isValid(clean)) {
    orQueries.push({ _id: clean });
  }

  return this.findOne({
    $or: orQueries,
    isActive: true,
  }).populate('courseId', 'title slug');
};

certificateStudentSchema.statics.findActiveByCertificateNumber = function (certNumber) {
  return this.findActiveByIdentifier(certNumber);
};

module.exports = mongoose.model('CertificateStudent', certificateStudentSchema);