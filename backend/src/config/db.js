
const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
/**
 * Connect to MongoDB using the MONGODB_URI environment variable.
 * Provides clear logging and handles connection errors gracefully.
 */
const connectDB = async (uri = process.env.MONGODB_URI) => {
  try {
    const conn = await mongoose.connect(uri, {
      // Modern mongoose defaults are used; can add connection pool settings here
      autoIndex: true, // Build indexes defined in schemas
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[Database] Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log('[Database] MongoDB Disconnected');
  } catch (error) {
    console.error(`[Database] Error disconnecting: ${error.message}`);
  }
};

module.exports = { connectDB, disconnectDB };
