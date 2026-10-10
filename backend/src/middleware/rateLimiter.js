const { redisClient } = require('../config/redis');

// In-memory fallback map for offline dev and unit tests
const inMemoryStore = new Map();

/**
 * Creates a Redis-backed rate limiter middleware with atomic increment and TTL reset.
 * 
 * @param {Object} options
 * @param {string} options.keyPrefix - Namespace prefix in Redis (e.g. 'ratelimit:login')
 * @param {number} options.max - Maximum allowed requests within the window
 * @param {number} options.windowSec - Window duration in seconds
 * @param {Function} options.keyGenerator - Generates the rate-limit identifier from req
 * @param {string} options.message - Custom error message on 429
 */
const createRateLimiter = ({
  keyPrefix = 'ratelimit',
  max = 10,
  windowSec = 60,
  keyGenerator = (req) => req.ip || 'unknown',
  message = 'Too many requests. Please try again later.',
}) => {
  return async (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      return next();
    }
    const identifier = keyGenerator(req);
    const key = `${keyPrefix}:${identifier}`;

    // 1. Redis-backed Rate Limiting
    if (redisClient && process.env.USE_IN_MEMORY_QUEUE !== 'true') {
      try {
        const multi = redisClient.multi();
        multi.incr(key);
        multi.ttl(key);
        const results = await multi.exec();

        const count = results[0][1];
        let ttl = results[1][1];

        // If key was newly created, set expiry window
        if (count === 1 || ttl === -1) {
          await redisClient.expire(key, windowSec);
          ttl = windowSec;
        }

        const remainingSec = ttl > 0 ? ttl : windowSec;
        const remainingRequests = Math.max(0, max - count);

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', remainingRequests);
        res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + remainingSec);

        if (count > max) {
          res.setHeader('Retry-After', remainingSec);
          return res.status(429).json({
            success: false,
            error: `${message} Retry after ${remainingSec} seconds.`,
            retryAfter: remainingSec,
          });
        }

        return next();
      } catch (err) {
        console.warn(`[RateLimiter] Redis error (${err.message}), falling back to memory store.`);
      }
    }

    // 2. In-Memory Fallback (for testing / offline Redis)
    const now = Date.now();
    let record = inMemoryStore.get(key);

    if (!record || now > record.resetAt) {
      record = {
        count: 1,
        resetAt: now + windowSec * 1000,
      };
      inMemoryStore.set(key, record);
    } else {
      record.count++;
    }

    const remainingSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    const remainingRequests = Math.max(0, max - record.count);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remainingRequests);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > max) {
      res.setHeader('Retry-After', remainingSec);
      return res.status(429).json({
        success: false,
        error: `${message} Retry after ${remainingSec} seconds.`,
        retryAfter: remainingSec,
      });
    }

    next();
  };
};

// Rate limiter for authentication / login attempts: 5 per IP per minute
const loginLimiter = createRateLimiter({
  keyPrefix: 'ratelimit:login',
  max: 5,
  windowSec: 60,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '127.0.0.1';
  },
  message: 'Too many login attempts from this IP.',
});

// Rate limiter for sample runs: 10 per user per minute
const runLimiter = createRateLimiter({
  keyPrefix: 'ratelimit:run',
  max: 10,
  windowSec: 60,
  keyGenerator: (req) => {
    return req.user ? req.user._id.toString() : req.ip || 'anonymous';
  },
  message: 'Run limit exceeded. You can run code at most 10 times per minute.',
});

// Rate limiter for submissions: 5 per user per minute
const submitLimiter = createRateLimiter({
  keyPrefix: 'ratelimit:submit',
  max: 5,
  windowSec: 60,
  keyGenerator: (req) => {
    return req.user ? req.user._id.toString() : req.ip || 'anonymous';
  },
  message: 'Submission limit exceeded. You can submit code at most 5 times per minute.',
});

// Rate limiter for AI Mentor: 10 requests per user per minute
const aiMentorLimiter = createRateLimiter({
  keyPrefix: 'ratelimit:ai-mentor',
  max: 10,
  windowSec: 60,
  keyGenerator: (req) => {
    return req.user ? req.user._id.toString() : req.ip || 'anonymous';
  },
  message: 'AI Mentor limit exceeded. You can use AI Mentor at most 10 times per minute.',
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  runLimiter,
  submitLimiter,
  aiMentorLimiter,
  inMemoryStore,
};