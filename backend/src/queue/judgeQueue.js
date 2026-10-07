const { Queue } = require('bullmq');
const { redisClient } = require('../config/redis');
const { judgeProcessor } = require('../workers/judgeProcessor');

const QUEUE_NAME = 'judge-queue';

let judgeQueue = null;

// Initialize BullMQ Queue if Redis is available
if (redisClient) {
  try {
    judgeQueue = new Queue(QUEUE_NAME, {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 3, // Retry up to 3 times on infrastructure errors
        backoff: {
          type: 'exponential',
          delay: 2000, // 2s, 4s, 8s backoff
        },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      },
    });
  } catch (err) {
    console.warn(`[Queue] Failed to initialize BullMQ Queue: ${err.message}`);
  }
}

let inMemoryWaiting = 0;
let inMemoryActive = 0;

/**
 * Returns current queue counts for Prometheus metrics
 */
const getQueueCounts = async () => {
  if (judgeQueue && process.env.USE_IN_MEMORY_QUEUE !== 'true') {
    try {
      const counts = await judgeQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
      return counts;
    } catch (err) {
      return { waiting: inMemoryWaiting, active: inMemoryActive, delayed: 0 };
    }
  }
  return { waiting: inMemoryWaiting, active: inMemoryActive, delayed: 0 };
};

/**
 * Enqueue a submission for asynchronous judging
 */
const addJudgeJob = async ({ submissionId }) => {
  // If in-memory fallback is requested (e.g. testing without Redis)
  if (process.env.USE_IN_MEMORY_QUEUE === 'true' || !judgeQueue) {
    console.log(`[Queue] Using in-memory job dispatcher for submission: ${submissionId}`);
    inMemoryWaiting++;
    // Run asynchronously without blocking HTTP response
    setImmediate(async () => {
      inMemoryWaiting = Math.max(0, inMemoryWaiting - 1);
      inMemoryActive++;
      try {
        await judgeProcessor({ data: { submissionId }, id: `mem-${submissionId}` });
      } catch (err) {
        console.error(`[Queue] In-memory job error for ${submissionId}: ${err.message}`);
      } finally {
        inMemoryActive = Math.max(0, inMemoryActive - 1);
      }
    });
    return { id: `mem-${submissionId}`, name: 'judge-submission' };
  }

  // BullMQ Redis Queue
  try {
    const job = await judgeQueue.add('judge-submission', { submissionId }, {
      jobId: submissionId.toString(), // Ensures one job per submission ID in the queue
    });
    console.log(`[Queue] Enqueued submission ${submissionId} as Job ID: ${job.id}`);
    return job;
  } catch (err) {
    console.warn(`[Queue] Redis enqueue failed (${err.message}). Falling back to async in-memory execution.`);
    inMemoryWaiting++;
    setImmediate(async () => {
      inMemoryWaiting = Math.max(0, inMemoryWaiting - 1);
      inMemoryActive++;
      try {
        await judgeProcessor({ data: { submissionId }, id: `fallback-${submissionId}` });
      } catch (procErr) {
        console.error(`[Queue] Fallback execution failed: ${procErr.message}`);
      } finally {
        inMemoryActive = Math.max(0, inMemoryActive - 1);
      }
    });
    return { id: `fallback-${submissionId}`, name: 'judge-submission' };
  }
};

module.exports = {
  judgeQueue,
  addJudgeJob,
  getQueueCounts,
  QUEUE_NAME,
};

