/**
 * models/QuestionBank.js
 * Reusable Question Bank Model supporting 6 question types:
 * 1. Single Choice (MCQ)
 * 2. Multiple Choice (Multi-select)
 * 3. True / False
 * 4. Fill in the Blank
 * 5. Short Answer
 * 6. Descriptive Answer
 * 
 * NOTE: Correct answers, accepted answers, and grading explanations are maintained
 * strictly on the server and must NEVER be exposed in student-facing payloads.
 */
const mongoose = require('mongoose');

const questionOptionSchema = new mongoose.Schema(
  {
    optionId: {
      type: String,
      required: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { _id: false }
);

const questionBankSchema = new mongoose.Schema(
  {
    questionText: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
    },
    questionType: {
      type: String,
      required: [true, 'Question type is required'],
      enum: [
        'single_choice',
        'multiple_choice',
        'true_false',
        'fill_blank',
        'short_answer',
        'descriptive',
      ],
      index: true,
    },
    options: {
      type: [questionOptionSchema],
      default: [],
    },
    // Server-side only: list of correct optionId(s) for MCQ/TF
    correctAnswers: {
      type: [String],
      default: [],
    },
    // Server-side only: list of accepted text variants for fill_blank
    acceptedAnswers: {
      type: [String],
      default: [],
    },
    caseSensitive: {
      type: Boolean,
      default: false,
    },
    marks: {
      type: Number,
      required: [true, 'Marks are required'],
      default: 1,
      min: [0.25, 'Marks must be at least 0.25'],
    },
    negativeMarks: {
      type: Number,
      default: 0,
      min: [0, 'Negative marks cannot be negative'],
    },
    explanation: {
      type: String,
      default: '',
      trim: true,
    },
    markingGuideline: {
      type: String,
      default: '',
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      index: true,
    },
    topic: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
      index: true,
    },
    image: {
      type: String,
      default: null,
      trim: true,
    },
    imagePublicId: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
      index: true,
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

// Compound and text indexes for fast search and filtering
questionBankSchema.index({ category: 1, status: 1 });
questionBankSchema.index({ category: 1, difficulty: 1, status: 1 });
questionBankSchema.index({ questionText: 'text', topic: 'text' });

/**
 * Strips correct answers, accepted variants, and explanations before sending to students.
 */
questionBankSchema.methods.toStudentJSON = function () {
  const obj = this.toObject();
  delete obj.correctAnswers;
  delete obj.acceptedAnswers;
  delete obj.explanation;
  delete obj.markingGuideline;
  delete obj.createdBy;
  delete obj.updatedBy;
  return obj;
};

module.exports = mongoose.model('QuestionBank', questionBankSchema);

