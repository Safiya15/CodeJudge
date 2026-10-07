const express = require('express');
const { Submission, Problem, Contest } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { submitLimiter } = require('../middleware/rateLimiter');
const { addJudgeJob } = require('../queue/judgeQueue');
const { submissionsTotal } = require('../services/metrics.service');

const router = express.Router();

const MAX_CODE_SIZE_BYTES = 64 * 1024; // 64 KB

/**
 * @route   POST /submissions
 * @desc    Submit code for evaluation against all test cases (Rate limited: 5/min)
 * @access  Private (Authenticated users)
 */
router.post('/submissions', requireAuth, submitLimiter, async (req, res, next) => {
  try {
    const { problemId, contestId, language, code } = req.body;

    if (!problemId || !language || !code) {
      return res.status(400).json({
        success: false,
        error: 'Please provide problemId, language, and code.',
      });
    }

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
        error: `Language '${language}' is not allowed for this problem. Allowed: [${problem.allowedLanguages.join(', ')}]`,
      });
    }

    // Contest Window & Participation Enforcement
    let validatedContestId = null;
    if (contestId) {
      const contest = await Contest.findById(contestId);
      if (!contest) {
        return res.status(404).json({
          success: false,
          error: 'Contest not found.',
        });
      }

      // 1. Verify user is registered for the contest
      const isParticipant = contest.participants?.some(
        (p) => p.toString() === req.user._id.toString()
      );
      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          error: 'You must join this contest before submitting solutions.',
        });
      }

      // 2. Verify server time is strictly inside contest window
      const now = Date.now();
      const startTime = new Date(contest.startTime).getTime();
      const endTime = new Date(contest.endTime).getTime();

      if (now < startTime) {
        return res.status(400).json({
          success: false,
          error: 'Submissions rejected: The contest has not started yet.',
        });
      }

      if (now > endTime) {
        return res.status(400).json({
          success: false,
          error: 'Submissions closed: The contest has already ended.',
        });
      }

      // 3. Verify problem belongs to the contest
      const belongsToContest = contest.problems?.some(
        (cp) => cp.problemId.toString() === problem._id.toString()
      );
      if (!belongsToContest) {
        return res.status(400).json({
          success: false,
          error: 'This problem is not part of the specified contest.',
        });
      }

      validatedContestId = contest._id;
    }

    // 1. Create Pending Submission record in MongoDB
    const submission = await Submission.create({
      userId: req.user._id,
      problemId: problem._id,
      contestId: validatedContestId,
      language: normalizedLang,
      code,
      status: 'Pending',
      verdict: null,
    });

    // 2. Enqueue judging job in BullMQ / Redis queue
    await addJudgeJob({ submissionId: submission._id });

    // Track submission metric
    submissionsTotal.inc({
      language: normalizedLang,
      contest: validatedContestId ? 'true' : 'false',
    });

    // 3. Return immediately with 201 Created and submission ID
    res.status(201).json({
      success: true,
      message: 'Submission received and enqueued for evaluation.',
      data: {
        submissionId: submission._id,
        status: submission.status,
        createdAt: submission.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /submissions/:id
 * @desc    Get submission details and verdict
 * @access  Private (Authenticated users; code is hidden from other students)
 */
router.get('/submissions/:id', requireAuth, async (req, res, next) => {
  try {
    const submission = await Submission.findById(req.params.id)
      .populate('problemId', 'title slug difficulty')
      .populate('userId', 'name email role')
      .lean();

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found.',
      });
    }

    // Security: Only the submission author or an admin can view the submitted source code
    const isOwner = req.user._id.toString() === submission.userId._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      delete submission.code; // Conceal code from other users
    }

    res.status(200).json({
      success: true,
      data: { submission },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /submissions
 * @desc    Get submissions list (with problemId, contestId, mine=true filtering)
 * @access  Private (Authenticated users)
 */
router.get('/submissions', requireAuth, async (req, res, next) => {
  try {
    const { problemId, contestId, mine, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (problemId) filter.problemId = problemId;
    if (contestId) filter.contestId = contestId;
    if (mine === 'true') filter.userId = req.user._id;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Fetch submissions list omitting code for performance and security
    const [submissions, total] = await Promise.all([
      Submission.find(filter)
        .select('-code')
        .populate('problemId', 'title slug difficulty')
        .populate('userId', 'name role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Submission.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        submissions,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
