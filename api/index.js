/**
 * api/index.js
 * Vercel Serverless Function entry point.
 * Ensures MongoDB connection is established before routing requests to Express app.
 */
const app = require('../app');
const connectDB = require('../config/db');

module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.error('Failed to connect to MongoDB in serverless handler:', err.message);
  }
  return app(req, res);
};
