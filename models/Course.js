/**
 * models/Course.js
 * Course schema — password-protected video collection with unique shareable slug.
 */
const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Generate a URL-friendly slug from a title with a random suffix.
 * Example: "Night Batch" → "night-batch-a8k2x"
 */
const generateSlug = (title) => {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
  const suffix = crypto.randomBytes(3).toString('hex').slice(0, 5);
  return `${base}-${suffix}`;
};

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Course title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    slug: {
      type: String,
      unique: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    thumbnail: {
      type: String,
      default: null,
    },
    passwordHash: {
      type: String,
      required: [true, 'Course password is required'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Auto-generate slug before saving if not set
courseSchema.pre('save', function (next) {
  if (!this.slug) {
    this.slug = generateSlug(this.title);
  }
  next();
});

// Static method to regenerate slug
courseSchema.methods.regenerateSlug = function () {
  this.slug = generateSlug(this.title);
  return this.slug;
};

// Text index for admin search
courseSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Course', courseSchema);
module.exports.generateSlug = generateSlug;
