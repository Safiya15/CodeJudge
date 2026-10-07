const { Submission, Problem, TestCase } = require('../models');
const { runSingleCase } = require('../services/judge0.service');
const { publishSubmissionUpdate } = require('../services/eventBus.service');
const { verdictTotal, judgeDurationSeconds } = require('../services/metrics.service');

/**
 * Core Judge Processor
 * 
 * Idempotent worker handler:
 * 1. Checks submission state; ignores if already Completed.
 * 2. Marks status as Processing and pushes real-time WebSocket update.
 * 3. Evaluates all test cases sequentially through Judge0 sandbox.
 * 4. Normalizes output (CRLF -> LF, trailing spaces trimmed).
 * 5. Short-circuits on first failure (Wrong Answer, TLE, MLE, Runtime Error, Compile Error).
 * 6. Records runtime, memory, failing test index, and saves Completed verdict to MongoDB.
 * 7. Pushes Completed verdict event over WebSocket to user's private channel.
 */
const judgeProcessor = async (job) => {
  const judgeStartTime = process.hrtime();
  const { submissionId } = job.data;
  console.log(`[JudgeWorker] Processing submission ${submissionId} (Job ID: ${job.id || 'direct'})`);

  const submission = await Submission.findById(submissionId);
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found in database.`);
  }

  // Idempotency check: if job was retried or previously completed, avoid duplicate evaluation
  if (submission.status === 'Completed') {
    console.log(`[JudgeWorker] Submission ${submissionId} already Completed. Skipping (Idempotent).`);
    return {
      submissionId,
      verdict: submission.verdict,
      status: submission.status,
      alreadyCompleted: true,
    };
  }

  // Update status to Processing and push live event
  submission.status = 'Processing';
  await submission.save();

  await publishSubmissionUpdate({
    submissionId: submission._id.toString(),
    userId: submission.userId.toString(),
    status: 'Processing',
    verdict: null,
  });

  const problem = await Problem.findById(submission.problemId);
  if (!problem) {
    submission.status = 'Failed';
    submission.verdict = 'Runtime Error';
    await submission.save();

    await publishSubmissionUpdate({
      submissionId: submission._id.toString(),
      userId: submission.userId.toString(),
      status: 'Failed',
      verdict: 'Runtime Error',
    });
    throw new Error(`Problem ${submission.problemId} not found.`);
  }

  // Fetch ALL test cases (both sample and hidden) in defined order
  const testCases = await TestCase.find({ problemId: problem._id }).sort({ order: 1 });
  if (testCases.length === 0) {
    submission.status = 'Failed';
    submission.verdict = 'Compilation Error';
    await submission.save();
    throw new Error(`No test cases configured for problem ${problem._id}`);
  }

  let finalVerdict = 'Accepted';
  let maxRuntimeMs = 0;
  let maxMemoryKb = 0;
  let failedTestIndex = null;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const testIndex = tc.order != null ? tc.order : i + 1;

    try {
      const execResult = await runSingleCase({
        code: submission.code,
        language: submission.language,
        stdin: tc.input,
        expectedOutput: tc.expectedOutput,
        timeLimitMs: problem.timeLimitMs,
        memoryLimitMb: problem.memoryLimitMb,
      });

      // Track resource consumption
      if (execResult.runtimeMs != null && execResult.runtimeMs > maxRuntimeMs) {
        maxRuntimeMs = execResult.runtimeMs;
      }
      if (execResult.memoryKb != null && execResult.memoryKb > maxMemoryKb) {
        maxMemoryKb = execResult.memoryKb;
      }

      // Check verdict
      if (execResult.status !== 'Accepted') {
        finalVerdict = execResult.status;
        failedTestIndex = testIndex;
        console.log(
          `[JudgeWorker] Submission ${submissionId} failed test #${testIndex} with ${finalVerdict}`
        );
        break; // Stop at first failing test case
      }
    } catch (caseErr) {
      console.error(`[JudgeWorker] Error executing case #${testIndex}: ${caseErr.message}`);
      finalVerdict = 'Runtime Error';
      failedTestIndex = testIndex;
      break;
    }
  }

  // Update and persist final verdict
  submission.status = 'Completed';
  submission.verdict = finalVerdict;
  submission.runtimeMs = maxRuntimeMs;
  submission.memoryKb = maxMemoryKb;
  submission.failedTestIndex = failedTestIndex;
  await submission.save();

  // Push real-time verdict event over WebSockets to user's private channel
  await publishSubmissionUpdate({
    submissionId: submission._id.toString(),
    userId: submission.userId.toString(),
    status: 'Completed',
    verdict: finalVerdict,
    runtimeMs: maxRuntimeMs,
    memoryKb: maxMemoryKb,
    failedTestIndex,
  });

  // If this submission belongs to an active contest, update the live Redis leaderboard
  if (submission.contestId) {
    try {
      const { updateContestantScore, refreshAndBroadcastLeaderboard } = require('../services/leaderboard.service');
      await updateContestantScore(submission.contestId, submission.userId);
      await refreshAndBroadcastLeaderboard(submission.contestId);
    } catch (lbErr) {
      console.error(`[JudgeWorker] Failed to update contest leaderboard: ${lbErr.message}`);
    }
  }

  // Record Prometheus metrics for judging duration and rendered verdict
  const judgeElapsed = process.hrtime(judgeStartTime);
  const judgeDurationSec = judgeElapsed[0] + judgeElapsed[1] / 1e9;
  judgeDurationSeconds.observe(
    { language: submission.language, verdict: finalVerdict },
    judgeDurationSec
  );
  verdictTotal.inc({
    verdict: finalVerdict,
    language: submission.language,
  });

  return {
    submissionId: submission._id,
    verdict: finalVerdict,
    runtimeMs: maxRuntimeMs,
    memoryKb: maxMemoryKb,
    failedTestIndex,
  };
};

module.exports = { judgeProcessor };
