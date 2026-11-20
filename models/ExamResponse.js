/**
 * models/ExamResponse.js
 * Student answers and grading evaluations per question per attempt.
 */
const mongoose = require('mongoose');

const examResponseSchema = new mongoose.Schema(
  {
    attemptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExamAttempt',
      required: true,
      index: true,
    },
    examinationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Examination',
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CertificateStudent',
      required: true,
      index: true,
    },
    // The specific snapshot question _id inside ExamAttempt.questionSnapshot
    snapshotQuestionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    originalQuestionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionBank',
      required: true,
    },
    // Can be String (single MCQ/True-False/Fill-Blank/Short/Descriptive) or Array of String (Multi-select)
    studentAnswer: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isMarkedForReview: {
      type: Boolean,
      default: false,
    },
    isAnswered: {
      type: Boolean,
      default: false,
    },
    lastSavedAt: {
      type: Date,
      default: Date.now,
    },
    // Evaluation state
    evaluationStatus: {
      type: String,
      enum: ['unanswered', 'auto_graded', 'pending_manual', 'manual_graded'],
      default: 'unanswered',
      index: true,
    },
    isCorrect: {
      type: Boolean,
      default: null,
    },
    maxMarks: {
      type: Number,
      required: true,
      default: 1,
    },
    awardedMarks: {
      type: Number,
      default: 0,
    },
    evaluatorComment: {
      type: String,
      default: '',
      trim: true,
    },
    evaluatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    evaluatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique response per attempt and snapshot question
examResponseSchema.index({ attemptId: 1, snapshotQuestionId: 1 }, { unique: true });

module.exports = mongoose.model('ExamResponse', examResponseSchema);

