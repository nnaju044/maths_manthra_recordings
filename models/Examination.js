/**
 * models/Examination.js
 * Examination configuration model supporting:
 * - Both Scheduled and Anytime availability modes
 * - Independent course linking (course-linked or standalone)
 * - Versioning and lock-on-attempt protection
 * - Question selection (Manual vs Random by category)
 * - Anti-cheating randomization settings
 */
const mongoose = require('mongoose');
const crypto = require('crypto');

const generateExamSlug = (title) => {
  const base = (title || 'exam')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
  const suffix = crypto.randomBytes(3).toString('hex').slice(0, 6);
  return `${base}-${suffix}`;
};

const generatePublicToken = () => {
  return crypto.randomBytes(16).toString('hex'); // 32-character cryptographically secure token
};

const examinationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Examination title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    slug: {
      type: String,
      unique: true,
      index: true,
    },
    // Unique unguessable public token for shareable student link (/exam/:publicToken)
    publicToken: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    instructions: {
      type: String,
      trim: true,
      default: 'Please answer all questions carefully before submitting. Ensure an active internet connection.',
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      index: true,
    },
    // Optional association with existing Course
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
      index: true,
    },
    thumbnail: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'closed', 'archived'],
      default: 'draft',
      index: true,
    },
    // Version number incremented on authorized structural modifications
    version: {
      type: Number,
      default: 1,
    },
    // Flag set to true once first student attempt has started
    isLocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Availability Mode
    availabilityMode: {
      type: String,
      enum: ['scheduled', 'anytime'],
      default: 'anytime',
      index: true,
    },
    // Scheduled window (used when availabilityMode === 'scheduled')
    startAt: {
      type: Date,
      default: null,
    },
    endAt: {
      type: Date,
      default: null,
    },
    // Exam Settings
    durationMinutes: {
      type: Number,
      required: [true, 'Duration in minutes is required'],
      min: [1, 'Duration must be at least 1 minute'],
      default: 60,
    },
    totalMarks: {
      type: Number,
      required: [true, 'Total marks are required'],
      min: [1, 'Total marks must be at least 1'],
      default: 100,
    },
    passingMarks: {
      type: Number,
      required: [true, 'Passing marks are required'],
      min: [0, 'Passing marks cannot be negative'],
      default: 40,
    },
    maxAttempts: {
      type: Number,
      default: 3,
      min: [1, 'Maximum attempts must be at least 1'],
    },
    negativeMarking: {
      type: Boolean,
      default: false,
    },
    randomizeQuestions: {
      type: Boolean,
      default: false,
    },
    randomizeOptions: {
      type: Boolean,
      default: false,
    },
    displayMode: {
      type: String,
      enum: ['one_at_a_time', 'all_at_once'],
      default: 'one_at_a_time',
    },
    showResultsImmediately: {
      type: Boolean,
      default: true,
    },
    showCorrectAnswersAfterEvaluation: {
      type: Boolean,
      default: false,
    },
    // Question Selection Settings
    questionSelectionMode: {
      type: String,
      enum: ['manual', 'random_category'],
      default: 'manual',
    },
    selectedQuestions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QuestionBank',
      },
    ],
    // For random_category selection rule
    randomSelectionRules: [
      {
        category: { type: String, trim: true },
        topic: { type: String, trim: true, default: '' },
        difficulty: { type: String, enum: ['any', 'easy', 'medium', 'hard'], default: 'any' },
        count: { type: Number, default: 1, min: 1 },
      },
    ],
    // Certificate generation toggle
    certificateEnabled: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate slug and publicToken before saving
examinationSchema.pre('save', function (next) {
  if (!this.slug) {
    this.slug = generateExamSlug(this.title);
  }
  if (!this.publicToken) {
    this.publicToken = generatePublicToken();
  }
  next();
});

// Text index for search
examinationSchema.index({ title: 'text', description: 'text', category: 'text' });

module.exports = mongoose.model('Examination', examinationSchema);
module.exports.generateExamSlug = generateExamSlug;
module.exports.generatePublicToken = generatePublicToken;

