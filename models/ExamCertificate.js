/**
 * models/ExamCertificate.js
 * Examination Certificate issuance model.
 * - Stores unique certificateNumber (e.g. MM-EXAM-2026-F93C2A)
 * - Stores an opaque, tamper-proof verificationToken (e.g. EVRF-8b43f9a712) for secure public validation
 * - Enforces 1 certificate per qualifying result
 * - Tracks administrative revocation status and audit logs
 */
const mongoose = require('mongoose');

const examCertificateSchema = new mongoose.Schema(
  {
    certificateNumber: {
      type: String,
      required: [true, 'Certificate number is required'],
      unique: true,
      trim: true,
      index: true,
    },
    // Opaque verification token for public QR and URL validation
    verificationToken: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CertificateStudent',
      required: true,
      index: true,
    },
    examinationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Examination',
      required: true,
      index: true,
    },
    attemptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExamAttempt',
      required: true,
    },
    resultId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExamResult',
      required: true,
      unique: true,
      index: true,
    },
    issueDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    status: {
      type: String,
      enum: ['valid', 'revoked'],
      default: 'valid',
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    revocationReason: {
      type: String,
      default: '',
      trim: true,
    },
    pdfUrl: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

examCertificateSchema.index({ studentId: 1, examinationId: 1, status: 1 });

module.exports = mongoose.model('ExamCertificate', examCertificateSchema);

