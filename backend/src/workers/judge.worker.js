
require('dotenv').config();

const { Worker } = require('bullmq');
const { redisClient } = require('../config/redis');
const { judgeProcessor } = require('./judgeProcessor');
const { Submission } = require('../models');
const { QUEUE_NAME } = require('../queue/judgeQueue');

const CONCURRENCY = parseInt(process.env.JUDGE_CONCURRENCY || '5', 10);

let workerInstance = null;

const startWorker = async () => {
  if (workerInstance) {
    return workerInstance;
  }

  if (process.env.USE_IN_MEMORY_QUEUE === 'true' || !redisClient) {
    throw new Error(
      'Judge worker requires Redis. Set USE_IN_MEMORY_QUEUE=false and configure REDIS_URL.'
    );
  }

  console.log('[JudgeWorker] Initializing judge worker...');

  workerInstance = new Worker(
    QUEUE_NAME,
    async (job) => judgeProcessor(job),
    {
      connection: redisClient,
      concurrency: CONCURRENCY,
    }
  );

  workerInstance.on('ready', () => {
    console.log(
      `[JudgeWorker] Ready on queue "${QUEUE_NAME}" (Concurrency: ${CONCURRENCY})`
    );
  });

  workerInstance.on('completed', (job, result) => {
    console.log(
      `[JudgeWorker] Job ${job.id} completed. Verdict: ${result?.verdict}`
    );
  });

  workerInstance.on('failed', async (job, err) => {
    console.error(`[JudgeWorker] Job ${job?.id} failed: ${err.message}`);

    if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
      try {
        const submissionId = job.data?.submissionId;
        if (submissionId) {
          await Submission.findByIdAndUpdate(submissionId, {
            status: 'Failed',
            verdict: 'Runtime Error',
          });
        }
      } catch (dbErr) {
        console.error(`[JudgeWorker] Database update failed: ${dbErr.message}`);
      }
    }
  });

  workerInstance.on('error', (err) => {
    console.error(`[JudgeWorker] Worker error: ${err.message}`);
  });

  return workerInstance;
};

// Preserve standalone worker support for `npm run worker`.
if (require.main === module) {
  const { connectDB, disconnectDB } = require('../config/db');

  (async () => {
    await connectDB();
    const worker = await startWorker();

    const shutdown = async () => {
      await worker.close();
      await disconnectDB();
      process.exit(0);
    };

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  })().catch((err) => {
    console.error('[JudgeWorker] Startup failed:', err);
    process.exit(1);
  });
}

module.exports = { startWorker };
