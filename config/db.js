/**
 * config/db.js
 * MongoDB connection using Mongoose.
 * Compatible with standalone server, Docker, and Vercel serverless functions.
 */
const mongoose = require('mongoose');

const getMongoUri = () => {
  const uri = (process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || '').trim();
  if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) {
    return uri;
  }
  return null;
};

const connectDB = async () => {
  // Reuse existing connection in warm serverless invocations
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  const mongoUri = getMongoUri();
  if (!mongoUri) {
    const errorMsg = 'No MongoDB connection URI found. Please set MONGO_URI or MONGODB_URI environment variable.';
    console.error(`❌ MongoDB connection error: ${errorMsg}`);
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
      process.exit(1);
    }
    throw new Error(errorMsg);
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    console.error(`❌ MongoDB connection error: ${err.message}`);
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
      process.exit(1);
    }
    throw err;
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
});

module.exports = connectDB;

