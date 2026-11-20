/**
 * models/ExamResult.js
 * Finalized examination result and scores calculation model.
 */
const mongoose = require('mongoose');

const examResultSchema = new mongoose.Schema(
  {
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
      unique: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CertificateStudent',
      required: true,
      index: true,
    },
    attemptNumber: {
      type: Number,
      required: true,
    },
    totalAvailableMarks: {
      type: Number,
      required: true,
      default: 0,
    },
    obtainedMarks: {
      type: Number,
      required: true,
      default: 0,
    },
    percentage: {
      type: Number,
      required: true,
      default: 0,
    },
    correctCount: {
      type: Number,
      default: 0,
    },
    incorrectCount: {
      type: Number,
      default: 0,
    },
    unansweredCount: {
      type: Number,
      default: 0,
    },
    pendingManualCount: {
      type: Number,
      default: 0,
    },
    isPassed: {
      type: Boolean,
      default: false,
      index: true,
    },
    resultStatus: {
      type: String,
      enum: ['pending_evaluation', 'finalized', 'published'],
      default: 'pending_evaluation',
      index: true,
    },
    finalizedAt: {
      type: Date,
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

examResultSchema.index({ examinationId: 1, studentId: 1 });
examResultSchema.index({ studentId: 1, isPassed: 1 });

module.exports = mongoose.model('ExamResult', examResultSchema);

