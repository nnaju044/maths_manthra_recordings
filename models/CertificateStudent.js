/**
 * models/CertificateStudent.js
 * Student details associated with an issued course certificate.
 */
const mongoose = require('mongoose');

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
 * Static method to find an active student record by certificate number
 * Supports trimmed exact and case-insensitive matching
 */
certificateStudentSchema.statics.findActiveByCertificateNumber = function (certNumber) {
  if (!certNumber || typeof certNumber !== 'string') return Promise.resolve(null);
  const clean = certNumber.trim();
  if (!clean) return Promise.resolve(null);

  return this.findOne({
    $or: [
      { certificateNumber: clean },
      { certificateNumber: clean.toUpperCase() },
      { certificateNumber: clean.toLowerCase() },
    ],
    isActive: true,
  }).populate('courseId', 'title slug');
};

module.exports = mongoose.model('CertificateStudent', certificateStudentSchema);