const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { initEventBus } = require('./services/eventBus.service');

let io = null;

const initSocket = async (httpServer) => {
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim());

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // Authentication Middleware for WebSocket handshakes
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

      if (!token) {
        return next(new Error('Authentication error: Token required.'));
      }

      const secret = process.env.JWT_SECRET || 'codejudge_super_secret_jwt_key_change_in_production';
      const decoded = jwt.verify(token, secret);

      socket.user = decoded;
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid or expired token.'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.userId;
    console.log(`[Socket] User connected: ${userId} (Socket ID: ${socket.id})`);

    // Automatically join the user's private channel for personal verdict notifications
    socket.join(`user:${userId}`);

    // Join / Leave contest rooms for live leaderboard updates
    socket.on('join:contest', (contestId) => {
      if (contestId) {
        socket.join(`contest:${contestId}`);
        console.log(`[Socket] User ${userId} joined room: contest:${contestId}`);
      }
    });

    socket.on('leave:contest', (contestId) => {
      if (contestId) {
        socket.leave(`contest:${contestId}`);
        console.log(`[Socket] User ${userId} left room: contest:${contestId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] User ${userId} disconnected (${reason})`);
    });
  });

  // Bind the distributed Pub/Sub event bus to Socket.io rooms
  await initEventBus(io);

  console.log('[Socket] Socket.io server initialized and listening for connections.');
  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io has not been initialized yet.');
  }
  return io;
};

module.exports = {
  initSocket,
  getIO,
};
