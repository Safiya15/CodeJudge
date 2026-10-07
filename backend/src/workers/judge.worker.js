require('dotenv').config();
const { Worker } = require('bullmq');
const { connectDB, disconnectDB } = require('../config/db');
const { redisClient } = require('../config/redis');
const { judgeProcessor } = require('./judgeProcessor');
const { Submission } = require('../models');
const { QUEUE_NAME } = require('../queue/judgeQueue');

const CONCURRENCY = parseInt(process.env.JUDGE_CONCURRENCY || '5', 10);

const startWorker = async () => {
  console.log('[JudgeWorker] Initializing Judge Worker process...');
  await connectDB();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      return judgeProcessor(job);
    },
    {
      connection: redisClient,
      concurrency: CONCURRENCY,
    }
  );

  worker.on('ready', () => {
    console.log(`[JudgeWorker] Worker ready and listening on queue "${QUEUE_NAME}" (Concurrency: ${CONCURRENCY})`);
  });

  worker.on('completed', (job, result) => {
    console.log(
      `[JudgeWorker] Job ${job.id} completed. Verdict: ${result.verdict} | Time: ${result.runtimeMs}ms | Memory: ${result.memoryKb}KB`
    );
  });

  worker.on('failed', async (job, err) => {
    console.error(`[JudgeWorker] Job ${job?.id} failed on attempt ${job?.attemptsMade}/${job?.opts?.attempts}: ${err.message}`);

    // If all retries exhausted, update submission status to 'Failed' in database
    if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
      console.error(`[JudgeWorker] Job ${job.id} exhausted all retry attempts. Marking submission as Failed.`);
      try {
        const submissionId = job.data?.submissionId;
        if (submissionId) {
          await Submission.findByIdAndUpdate(submissionId, {
            status: 'Failed',
            verdict: 'Runtime Error',
          });
        }
      } catch (dbErr) {
        console.error(`[JudgeWorker] Failed to update submission state on retry exhaustion: ${dbErr.message}`);
      }
    }
  });

  worker.on('error', (err) => {
    console.error(`[JudgeWorker] Worker internal error: ${err.message}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[JudgeWorker] Received ${signal}. Draining active jobs and shutting down...`);
    try {
      await worker.close();
      console.log('[JudgeWorker] BullMQ Worker closed.');
      await disconnectDB();
      console.log('[JudgeWorker] Disconnected from database.');
      process.exit(0);
    } catch (err) {
      console.error(`[JudgeWorker] Error during shutdown: ${err.message}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

if (require.main === module) {
  startWorker();
}

module.exports = { startWorker };
