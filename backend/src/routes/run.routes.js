const express = require('express');
const { Problem, TestCase } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { runLimiter } = require('../middleware/rateLimiter');
const { runSingleCase } = require('../services/judge0.service');

const router = express.Router();

const MAX_CODE_SIZE_BYTES = 64 * 1024; // 64 KB limit

/**
 * @route   POST /run
 * @desc    Execute code against sample (visible) test cases only (Rate limited: 10/min)
 * @access  Private (Authenticated users)
 */
router.post('/run', requireAuth, runLimiter, async (req, res, next) => {
  try {
    const { problemId, language, code } = req.body;

    // Validate inputs
    if (!problemId || !language || !code) {
      return res.status(400).json({
        success: false,
        error: 'Please provide problemId, language, and code.',
      });
    }

    // Code length / payload size check
    if (Buffer.byteLength(code, 'utf8') > MAX_CODE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Code size exceeds maximum limit of ${MAX_CODE_SIZE_BYTES / 1024} KB.`,
      });
    }

    const problem = await Problem.findById(problemId);
    if (!problem) {
      return res.status(404).json({
        success: false,
        error: 'Problem not found.',
      });
    }

    const normalizedLang = language.toLowerCase();
    if (!problem.allowedLanguages.includes(normalizedLang)) {
      return res.status(400).json({
        success: false,
        error: `Language '${language}' is not permitted for this problem. Allowed: [${problem.allowedLanguages.join(', ')}]`,
      });
    }

    // Strictly fetch ONLY sample (visible) test cases
    const sampleCases = await TestCase.find({
      problemId: problem._id,
      isHidden: false,
    }).sort({ order: 1 });

    if (sampleCases.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No sample test cases configured for this problem.',
      });
    }

    const results = [];
    let allPassed = true;

    for (let i = 0; i < sampleCases.length; i++) {
      const tc = sampleCases[i];
      const execResult = await runSingleCase({
        code,
        language: normalizedLang,
        stdin: tc.input,
        expectedOutput: tc.expectedOutput,
        timeLimitMs: problem.timeLimitMs,
        memoryLimitMb: problem.memoryLimitMb,
      });

      const casePassed = execResult.status === 'Accepted';
      if (!casePassed) allPassed = false;

      results.push({
        caseIndex: tc.order || i + 1,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        actualOutput: execResult.stdout,
        stderr: execResult.stderr,
        compileError: execResult.compileError,
        status: execResult.status,
        runtimeMs: execResult.runtimeMs,
        memoryKb: execResult.memoryKb,
      });

      // If compilation error occurred, stop running remaining cases
      if (execResult.status === 'Compilation Error') {
        break;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        passed: allPassed,
        results,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
