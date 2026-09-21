/**
 * models/Video.js
 * Video schema — a single recorded class entry within a course.
 * Replaces the old Lesson + Chapter hierarchy with a flat Day 1, Day 2, … structure.
 */
const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: [true, 'Course is required'],
    },
    dayNumber: {
      type: Number,
      required: [true, 'Day number is required'],
      min: [1, 'Day number must be at least 1'],
    },
    title: {
      type: String,
      required: [true, 'Video title is required'],
      trim: true,
      maxlength: [300, 'Title cannot exceed 300 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [3000, 'Description cannot exceed 3000 characters'],
    },
    youtubeUrl: {
      type: String,
      trim: true,
    },
    youtubeId: {
      type: String,
      required: [true, 'YouTube Video ID is required'],
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    pdfTitle: {
      type: String,
      trim: true,
      maxlength: [300, 'PDF title cannot exceed 300 characters'],
    },
    pdfUrl: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Compound index for efficient per-course queries sorted by order
videoSchema.index({ courseId: 1, order: 1 });
videoSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Video', videoSchema);
