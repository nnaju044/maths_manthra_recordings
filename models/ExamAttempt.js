/**
 * models/ExamAttempt.js
 * Student examination attempt model with:
 * - Immutable question snapshots
 * - Server-enforced start and expiration timestamps
 * - Atomic allocation lock (`activeAttemptLock`) to prevent concurrent attempts
 * - Status transitions: in_progress -> submitted / expired / abandoned
 */
const mongoose = require('mongoose');

const questionSnapshotSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionBank',
      required: true,
    },
    questionText: {
      type: String,
      required: true,
    },
    questionType: {
      type: String,
      required: true,
    },
    options: [
      {
        optionId: String,
        text: String,
        image: String,
      },
    ],
    marks: {
      type: Number,
      required: true,
    },
    negativeMarks: {
      type: Number,
      default: 0,
    },
    // Server-side only: private answer keys stored for offline/isolated grading
    privateAnswerKeys: {
      correctAnswers: [String],
      acceptedAnswers: [String],
      caseSensitive: Boolean,
      explanation: String,
    },
  },
  { _id: true }
);

const examAttemptSchema = new mongoose.Schema(
  {
    examinationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Examination',
      required: [true, 'Examination is required'],
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CertificateStudent',
      required: [true, 'Student is required'],
      index: true,
    },
    attemptNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    // Active attempt lock: populated with studentId while 'in_progress', removed ($unset) upon completion.
    // Coupled with partial unique compound index on { examinationId: 1, activeAttemptLock: 1 }
    // to strictly enforce at most one in-progress attempt per (examination, student) pair.
    activeAttemptLock: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CertificateStudent',
      default: undefined,
    },
    status: {
      type: String,
      enum: ['in_progress', 'submitted', 'expired', 'abandoned'],
      default: 'in_progress',
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    examVersion: {
      type: Number,
      default: 1,
    },
    // Immutable snapshot of questions taken at exam start
    questionSnapshot: [questionSnapshotSchema],
    // Audit log for administrative reopenings / interventions
    auditLogs: [
      {
        action: String,
        performedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        reason: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Unique compound index: only 1 record per exam + student + attemptNumber
examAttemptSchema.index(
  { examinationId: 1, studentId: 1, attemptNumber: 1 },
  { unique: true }
);

// Partial unique compound index on { examinationId, activeAttemptLock }:
// - Restricted only to documents where status === 'in_progress' and activeAttemptLock exists.
// - Guarantees a student can NEVER have 2 concurrent in-progress attempts for the same exam.
// - Allows the student to take different examinations simultaneously when schedules permit.
// - Finalized/submitted attempts unset activeAttemptLock so they never collide.
examAttemptSchema.index(
  { examinationId: 1, activeAttemptLock: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'in_progress',
      activeAttemptLock: { $exists: true, $type: 'objectId' },
    },
  }
);

/**
 * Returns question snapshot without private answer keys for student UI
 */
examAttemptSchema.methods.getSanitizedQuestions = function () {
  return this.questionSnapshot.map((q) => {
    const qObj = q.toObject();
    delete qObj.privateAnswerKeys;
    return qObj;
  });
};

module.exports = mongoose.model('ExamAttempt', examAttemptSchema);

