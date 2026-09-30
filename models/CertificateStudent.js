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
    // --- WEEKLY PERFORMANCE (Academic 0-5 system, Max Total: 40) ---
    weeklyPerformance: {
      week1: {
        assignmentHomework: { type: Number, default: 0, min: 0, max: 5 },
        activityEngagement: { type: Number, default: 0, min: 0, max: 5 },
      },
      week2: {
        assignmentHomework: { type: Number, default: 0, min: 0, max: 5 },
        activityEngagement: { type: Number, default: 0, min: 0, max: 5 },
      },
      week3: {
        assignmentHomework: { type: Number, default: 0, min: 0, max: 5 },
        activityEngagement: { type: Number, default: 0, min: 0, max: 5 },
      },
      week4: {
        assignmentHomework: { type: Number, default: 0, min: 0, max: 5 },
        activityEngagement: { type: Number, default: 0, min: 0, max: 5 },
      },
    },

    // Legacy fields kept for backward compatibility:
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
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals for weekly performance calculation (0-10 per week, 0-40 total)
certificateStudentSchema.virtual('week1Total').get(function () {
  const wp = this.weeklyPerformance?.week1;
  const ah = typeof wp?.assignmentHomework === 'number' ? wp.assignmentHomework : 0;
  const ae = typeof wp?.activityEngagement === 'number' ? wp.activityEngagement : 0;
  if (ah > 0 || ae > 0) return Math.min(10, Math.max(0, ah + ae));

  const legAh = parseFloat(this.week1?.assignmentHomework) || 0;
  const legAe = parseFloat(this.week1?.activityEngagement) || 0;
  return Math.min(10, Math.max(0, legAh + legAe));
});

certificateStudentSchema.virtual('week2Total').get(function () {
  const wp = this.weeklyPerformance?.week2;
  const ah = typeof wp?.assignmentHomework === 'number' ? wp.assignmentHomework : 0;
  const ae = typeof wp?.activityEngagement === 'number' ? wp.activityEngagement : 0;
  if (ah > 0 || ae > 0) return Math.min(10, Math.max(0, ah + ae));

  const legAh = parseFloat(this.week2?.assignmentHomework) || 0;
  const legAe = parseFloat(this.week2?.activityEngagement) || 0;
  return Math.min(10, Math.max(0, legAh + legAe));
});

certificateStudentSchema.virtual('week3Total').get(function () {
  const wp = this.weeklyPerformance?.week3;
  const ah = typeof wp?.assignmentHomework === 'number' ? wp.assignmentHomework : 0;
  const ae = typeof wp?.activityEngagement === 'number' ? wp.activityEngagement : 0;
  if (ah > 0 || ae > 0) return Math.min(10, Math.max(0, ah + ae));

  const legAh = parseFloat(this.week3?.assignmentHomework) || 0;
  const legAe = parseFloat(this.week3?.activityEngagement) || 0;
  return Math.min(10, Math.max(0, legAh + legAe));
});

certificateStudentSchema.virtual('week4Total').get(function () {
  const wp = this.weeklyPerformance?.week4;
  const ah = typeof wp?.assignmentHomework === 'number' ? wp.assignmentHomework : 0;
  const ae = typeof wp?.activityEngagement === 'number' ? wp.activityEngagement : 0;
  if (ah > 0 || ae > 0) return Math.min(10, Math.max(0, ah + ae));

  const legAh = parseFloat(this.week4?.assignmentHomework) || 0;
  const legAe = parseFloat(this.week4?.activityEngagement) || 0;
  return Math.min(10, Math.max(0, legAh + legAe));
});

certificateStudentSchema.virtual('weeklyPerformanceTotal').get(function () {
  return Math.min(40, this.week1Total + this.week2Total + this.week3Total + this.week4Total);
});

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