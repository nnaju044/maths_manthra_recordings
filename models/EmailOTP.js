/**
 * models/EmailOTP.js
 * Stores one-time passcodes for email verification before certificate access.
 * Documents auto-expire after 10 minutes via MongoDB TTL index.
 */
const mongoose = require('mongoose');

const emailOTPSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    index: true,
  },
  otp: {
    type: String,
    required: [true, 'OTP is required'],
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: 5,
  },
  verified: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600, // TTL: auto-delete after 10 minutes (600 seconds)
  },
});

// Compound index for fast lookups
emailOTPSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('EmailOTP', emailOTPSchema);
