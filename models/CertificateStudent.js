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

module.exports = mongoose.model('CertificateStudent', certificateStudentSchema);