const express = require('express');
const mongoose = require('mongoose');

const { requireAuth } = require('../middleware/auth');
const { aiMentorLimiter } = require('../middleware/rateLimiter');
const { Problem, Contest } = require('../models');
const { mentor } = require('../services/aiMentor.service');

const router = express.Router();

const ALLOWED_MODES = new Set([
  'hint',
  'explain_error',
  'review_code',
  'complexity',
]);

const ALLOWED_LANGUAGES = new Set([
  'cpp',
  'python',
  'java',
  'javascript',
]);

router.post(
  '/mentor',
  requireAuth,
  aiMentorLimiter,
  async (req, res, next) => {
    try {
      const {
        problemId,
        mode,
        code = '',
        language = '',
        errorMessage = '',
        contestId = null,
      } = req.body;

      // ---------------------------------------------------------
      // 1. Validate mode
      // ---------------------------------------------------------
      if (!mode || !ALLOWED_MODES.has(mode)) {
        return res.status(400).json({
          success: false,
          error:
            'Invalid AI Mentor mode. Allowed modes: hint, explain_error, review_code, complexity.',
        });
      }

      // ---------------------------------------------------------
      // 2. Validate problem ID
      // ---------------------------------------------------------
      if (!problemId || !mongoose.Types.ObjectId.isValid(problemId)) {
        return res.status(400).json({
          success: false,
          error: 'A valid problemId is required.',
        });
      }

      // ---------------------------------------------------------
      // 3. Contest requests are explicitly rejected
      // ---------------------------------------------------------
      if (contestId) {
        return res.status(403).json({
          success: false,
          message: 'AI Mentor is available only for practice problems.',
        });
      }

      // ---------------------------------------------------------
      // 4. Load the actual problem
      // ---------------------------------------------------------
      const problem = await Problem.findById(problemId).select(
        'title statement difficulty tags allowedLanguages'
      );

      if (!problem) {
        return res.status(404).json({
          success: false,
          error: 'Problem not found.',
        });
      }

      // ---------------------------------------------------------
      // 5. Server-side contest protection
      //
      // Even if the frontend hides the AI button, we independently
      // check whether this problem is currently part of an active
      // contest.
      // ---------------------------------------------------------
      const now = new Date();

      const activeContest = await Contest.findOne({
        startTime: { $lte: now },
        endTime: { $gte: now },
        'problems.problemId': problem._id,
      }).select('_id name startTime endTime');

      if (activeContest) {
        return res.status(403).json({
          success: false,
          message: 'AI Mentor is available only for practice problems.',
        });
      }

      // ---------------------------------------------------------
      // 6. Validate language
      // ---------------------------------------------------------
      if (language && !ALLOWED_LANGUAGES.has(language)) {
        return res.status(400).json({
          success: false,
          error: 'Unsupported programming language.',
        });
      }

      if (
        language &&
        Array.isArray(problem.allowedLanguages) &&
        problem.allowedLanguages.length > 0 &&
        !problem.allowedLanguages.includes(language)
      ) {
        return res.status(400).json({
          success: false,
          error: `Language '${language}' is not allowed for this problem.`,
        });
      }

      // ---------------------------------------------------------
      // 7. Validate mode-specific inputs
      // ---------------------------------------------------------
      if (
        ['review_code', 'complexity', 'explain_error'].includes(mode) &&
        !code.trim()
      ) {
        return res.status(400).json({
          success: false,
          error: 'Student code is required for this AI Mentor mode.',
        });
      }

      if (mode === 'explain_error' && !errorMessage.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Error or compiler output is required for explain_error mode.',
        });
      }

      // ---------------------------------------------------------
      // 8. Ask AI Mentor
      // ---------------------------------------------------------
      const answer = await mentor({
        mode,
        problem,
        code,
        language,
        errorMessage,
      });

      return res.status(200).json({
        success: true,
        data: {
          mode,
          mentorResponse: answer,
        },
      });
    } catch (error) {
      console.error('[AI Mentor] Error:', error);

      if (error.message === 'OPENAI_API_KEY is not configured.') {
        return res.status(503).json({
          success: false,
          error: 'AI Mentor is not configured on the server.',
        });
      }

      return next(error);
    }
  }
);

module.exports = router;