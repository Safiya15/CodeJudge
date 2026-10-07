const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Shared Redis connection instance for BullMQ and application caches.
 * BullMQ requires maxRetriesPerRequest: null.
 */
const getRedisConnection = () => {
  if (process.env.USE_IN_MEMORY_QUEUE === 'true') {
    return null;
  }

  const connection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      // Exponential backoff up to 3 seconds between retries
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
    lazyConnect: true, // Connect explicitly when needed
  });

  connection.on('connect', () => {
    console.log('[Redis] Connected to Redis server.');
  });

  connection.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test' && process.env.USE_IN_MEMORY_QUEUE !== 'true') {
      console.warn(`[Redis] Connection warning: ${err.message}`);
    }
  });

  return connection;
};

const redisClient = getRedisConnection();

module.exports = {
  redisClient,
  getRedisConnection,
};
