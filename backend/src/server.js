
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config();

const http = require('http');
const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');
const { initSocket } = require('./socket');
const { startWorker } = require('./workers/judge.worker');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  // Start the API server
  const server = http.createServer(app);
  await initSocket(server);

  server.listen(PORT, () => {
    console.log(`[Server] CodeJudge Backend API running on port ${PORT}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Start the judge worker in this same process
  await startWorker();

  console.log('[Server] Judge worker startup completed.');

  const shutdown = async (signal) => {
    console.log(`\n[Server] Received ${signal}. Shutting down...`);

    server.close(async () => {
      try {
        await disconnectDB();
        console.log('[Server] Graceful shutdown completed.');
        process.exit(0);
      } catch (err) {
        console.error('[Server] Shutdown error:', err.message);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  });
}

module.exports = { startServer };
