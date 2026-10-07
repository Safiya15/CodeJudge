const express = require('express');
const { Contest, Problem } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getContestLeaderboard } = require('../services/leaderboard.service');

const router = express.Router();

/**
 * Helper to determine contest lifecycle status based on server time
 */
const getContestStatus = (startTime, endTime) => {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (now < start) return 'Upcoming';
  if (now > end) return 'Ended';
  return 'Live';
};

/**
 * @route   POST /contests
 * @desc    Create a new contest (Admin only)
 * @access  Private (Admin)
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, startTime, endTime, problems } = req.body;

    if (!name || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: 'Contest name, startTime, and endTime are required.',
      });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format provided for startTime or endTime.',
      });
    }

    if (start >= end) {
      return res.status(400).json({
        success: false,
        error: 'Contest startTime must be strictly before endTime.',
      });
    }

    const validatedProblems = [];

    if (Array.isArray(problems) && problems.length > 0) {
      for (const item of problems) {
        const prob = await Problem.findById(item.problemId);

        if (!prob) {
          return res.status(400).json({
            success: false,
            error: `Problem with ID '${item.problemId}' does not exist.`,
          });
        }

        validatedProblems.push({
          problemId: prob._id,
          points: item.points ? Number(item.points) : 100,
        });
      }
    }

    const contest = await Contest.create({
      name: name.trim(),
      startTime: start,
      endTime: end,
      problems: validatedProblems,
      createdBy: req.user._id,

      // Admin creates the contest but does NOT join it.
      participants: [],
    });

    res.status(201).json({
      success: true,
      message: 'Contest created successfully.',
      data: { contest },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /contests
 * @desc    List all contests with dynamic status and participant counts
 * @access  Public
 */
router.get('/', async (req, res, next) => {
  try {
    const contests = await Contest.find()
      .populate('problems.problemId', 'title slug difficulty')
      .sort({ startTime: -1 })
      .lean();

    const formatted = contests.map((c) => ({
      _id: c._id,
      name: c.name,
      startTime: c.startTime,
      endTime: c.endTime,
      status: getContestStatus(c.startTime, c.endTime),
      problemsCount: c.problems ? c.problems.length : 0,
      participantsCount: c.participants ? c.participants.length : 0,
      createdAt: c.createdAt,
    }));

    res.status(200).json({
      success: true,
      data: { contests: formatted },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /contests/:id
 * @desc    Get contest details and problems
 * @access  Private
 *
 * This route is authenticated so we can correctly determine whether
 * the current logged-in student has registered for the contest.
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const contest = await Contest.findById(req.params.id)
      .populate(
        'problems.problemId',
        'title slug difficulty tags timeLimitMs memoryLimitMb allowedLanguages'
      )
      .lean();

    if (!contest) {
      return res.status(404).json({
        success: false,
        error: 'Contest not found.',
      });
    }

    const status = getContestStatus(
      contest.startTime,
      contest.endTime
    );

    const isUpcoming = status === 'Upcoming';

    const currentUserId = req.user?._id?.toString();

    const isRegistered = Boolean(
      currentUserId &&
      Array.isArray(contest.participants) &&
      contest.participants.some(
        (participantId) =>
          participantId.toString() === currentUserId
      )
    );

    res.status(200).json({
      success: true,
      data: {
        contest: {
          ...contest,
          status,
          isUpcoming,
          isRegistered,
          participantsCount: contest.participants
            ? contest.participants.length
            : 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /contests/:id/join
 * @desc    Register/join a contest
 * @access  Private (Students only)
 */
router.post('/:id/join', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Only students can join contests.',
      });
    }

    const contest = await Contest.findById(req.params.id);

    if (!contest) {
      return res.status(404).json({
        success: false,
        error: 'Contest not found.',
      });
    }

    const userId = req.user._id;

    const isAlreadyJoined = contest.participants.some(
      (participantId) =>
        participantId.toString() === userId.toString()
    );

    if (!isAlreadyJoined) {
      contest.participants.push(userId);
      await contest.save();
    }

    res.status(200).json({
      success: true,
      message: 'Successfully registered for the contest.',
      data: {
        contestId: contest._id,
        isJoined: true,
        isRegistered: true,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /contests/:id/leaderboard
 * @desc    Get real-time ranked contest leaderboard
 * @access  Public
 */
router.get('/:id/leaderboard', async (req, res, next) => {
  try {
    const contest = await Contest.findById(req.params.id);

    if (!contest) {
      return res.status(404).json({
        success: false,
        error: 'Contest not found.',
      });
    }

    const leaderboard = await getContestLeaderboard(contest._id);

    /*
     * IMPORTANT:
     * Only registered contest participants are allowed to appear
     * on the contest leaderboard.
     *
     * This also removes stale Redis/in-memory leaderboard entries
     * from users who are not currently registered.
     */
    const registeredUserIds = new Set(
      (contest.participants || []).map((id) => id.toString())
    );

    const filteredLeaderboard = leaderboard.filter((entry) => {
      const leaderboardUserId =
        entry.userId?.toString();

      return (
        leaderboardUserId &&
        registeredUserIds.has(leaderboardUserId)
      );
    });

    res.status(200).json({
      success: true,
      data: {
        leaderboard: filteredLeaderboard,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;