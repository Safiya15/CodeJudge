const EventEmitter = require('events');
const { getRedisConnection } = require('../config/redis');

const localEmitter = new EventEmitter();

const CHANNELS = {
  SUBMISSION_UPDATES: 'codejudge:submission_updates',
  LEADERBOARD_UPDATES: 'codejudge:leaderboard_updates',
};

let pubClient = null;
let subClient = null;
let ioInstance = null;

/**
 * Initialize the event bus with the Socket.io instance.
 * Subscribes to Redis Pub/Sub channels (or local EventEmitter in offline/test mode).
 */
const initEventBus = async (io) => {
  ioInstance = io;

  // If in-memory mode is active, bind local emitter to Socket.io rooms
  if (process.env.USE_IN_MEMORY_QUEUE === 'true') {
    console.log('[EventBus] Initialized in local EventEmitter mode.');
    localEmitter.on(CHANNELS.SUBMISSION_UPDATES, (payload) => {
      if (ioInstance && payload.userId) {
        ioInstance.to(`user:${payload.userId}`).emit('submission:update', payload);
      }
    });
    localEmitter.on(CHANNELS.LEADERBOARD_UPDATES, (payload) => {
      if (ioInstance && payload.contestId) {
        ioInstance.to(`contest:${payload.contestId}`).emit('leaderboard:update', payload);
      }
    });
    return;
  }

  // Redis Pub/Sub mode for distributed multi-process architecture
  try {
    pubClient = getRedisConnection();
    subClient = getRedisConnection();

    if (pubClient && subClient) {
      await subClient.connect().catch(() => {});
      await pubClient.connect().catch(() => {});

      await subClient.subscribe(CHANNELS.SUBMISSION_UPDATES, CHANNELS.LEADERBOARD_UPDATES);

      subClient.on('message', (channel, message) => {
        try {
          const payload = JSON.parse(message);
          if (channel === CHANNELS.SUBMISSION_UPDATES && payload.userId && ioInstance) {
            ioInstance.to(`user:${payload.userId}`).emit('submission:update', payload);
          } else if (channel === CHANNELS.LEADERBOARD_UPDATES && payload.contestId && ioInstance) {
            ioInstance.to(`contest:${payload.contestId}`).emit('leaderboard:update', payload);
          }
        } catch (err) {
          console.error(`[EventBus] Error handling pub/sub message: ${err.message}`);
        }
      });

      console.log('[EventBus] Subscribed to Redis channels for real-time WebSocket distribution.');
    }
  } catch (err) {
    console.warn(`[EventBus] Redis Pub/Sub initialization skipped: ${err.message}`);
  }
};

/**
 * Publish a submission status update (called by Judge Worker process)
 */
const publishSubmissionUpdate = async (payload) => {
  if (process.env.USE_IN_MEMORY_QUEUE === 'true' || !pubClient) {
    localEmitter.emit(CHANNELS.SUBMISSION_UPDATES, payload);
    return;
  }

  try {
    await pubClient.publish(CHANNELS.SUBMISSION_UPDATES, JSON.stringify(payload));
  } catch (err) {
    console.warn(`[EventBus] Redis publish failed, falling back to local emit: ${err.message}`);
    localEmitter.emit(CHANNELS.SUBMISSION_UPDATES, payload);
  }
};

/**
 * Publish a leaderboard update (called when contest submission completes)
 */
const publishLeaderboardUpdate = async (payload) => {
  if (process.env.USE_IN_MEMORY_QUEUE === 'true' || !pubClient) {
    localEmitter.emit(CHANNELS.LEADERBOARD_UPDATES, payload);
    return;
  }

  try {
    await pubClient.publish(CHANNELS.LEADERBOARD_UPDATES, JSON.stringify(payload));
  } catch (err) {
    console.warn(`[EventBus] Redis publish failed, falling back to local emit: ${err.message}`);
    localEmitter.emit(CHANNELS.LEADERBOARD_UPDATES, payload);
  }
};

module.exports = {
  initEventBus,
  publishSubmissionUpdate,
  publishLeaderboardUpdate,
  CHANNELS,
};
