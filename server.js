/**
 * server.js
 * Entry point — connects to MongoDB then starts Express server.
 */
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`\n🚀 Maths Mantras server running`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Env:     ${process.env.NODE_ENV || 'development'}\n`);
  });
};

start();
