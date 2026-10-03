/**
 * models/Counter.js
 * Tracks auto-incrementing sequential numbers by year for certificates.
 */
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    lastNumber: {
      type: Number,
      required: true,
      default: 20000,
    },
    lastStudentNumber: {
      type: Number,
      default: 27,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Counter', counterSchema);
