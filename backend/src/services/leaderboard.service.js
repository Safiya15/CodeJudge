const { Submission, Contest, User } = require('../models');
const { redisClient } = require('../config/redis');
const { publishLeaderboardUpdate } = require('./eventBus.service');

const PENALTY_PER_WRONG_ATTEMPT_MINUTES = 20;
const SCORE_MULTIPLIER = 10000000; // 10^7

// In-memory fallback cache for test/offline environments
const inMemoryLeaderboardCache = new Map();

/**
 * Calculates a single contestant's score and penalty according to ICPC rules:
 * - Problems Solved: Primary sort key (higher is better)
 * - Penalty: Tie-breaker (lower is better) = sum of solve times (minutes from contest start) + 20 mins per wrong attempt before AC
 * - Composite Redis Score = (Problems Solved * 10^7) - Total Penalty
 */
const calculateUserScore = async (contest, userId) => {
  const contestStartTime = new Date(contest.startTime).getTime();

  // Fetch all user submissions inside this contest window sorted by submission time
  const submissions = await Submission.find({
    contestId: contest._id,
    userId,
    status: 'Completed',
  }).sort({ createdAt: 1 });

  // Group submissions by problem
  const problemSubmissions = {};
  for (const sub of submissions) {
    const pId = sub.problemId.toString();
    if (!problemSubmissions[pId]) {
      problemSubmissions[pId] = [];
    }
    problemSubmissions[pId].push(sub);
  }

  let problemsSolved = 0;
  let totalPenalty = 0;
  const problemDetails = {};

  for (const cp of contest.problems) {
    const pId = cp.problemId.toString();
    const subs = problemSubmissions[pId] || [];

    let solved = false;
    let wrongAttempts = 0;
    let solveTime = null;

    for (const sub of subs) {
      if (sub.verdict === 'Accepted') {
        solved = true;
        const subTime = new Date(sub.createdAt).getTime();
        solveTime = Math.max(0, Math.floor((subTime - contestStartTime) / 60000));
        break; // Only first accepted submission counts
      } else {
        // Only count attempts that failed before the first AC
        wrongAttempts++;
      }
    }

    if (solved) {
      problemsSolved++;
      const problemPenalty = solveTime + wrongAttempts * PENALTY_PER_WRONG_ATTEMPT_MINUTES;
      totalPenalty += problemPenalty;

      problemDetails[pId] = {
        solved: true,
        points: cp.points,
        solveTime,
        wrongAttempts,
      };
    } else {
      problemDetails[pId] = {
        solved: false,
        points: 0,
        solveTime: null,
        wrongAttempts,
      };
    }
  }

  // Composite score: Solved * 10^7 - Penalty
  const compositeScore = problemsSolved * SCORE_MULTIPLIER - totalPenalty;

  return {
    userId: userId.toString(),
    problemsSolved,
    totalPenalty,
    compositeScore,
    problemDetails,
  };
};

/**
 * Updates a contestant's score in the Redis Sorted Set
 */
const updateContestantScore = async (contestId, userId) => {
  const contest = await Contest.findById(contestId);
  if (!contest) return null;

  const user = await User.findById(userId).select('name email');
  if (!user) return null;

  const scoreData = await calculateUserScore(contest, userId);
  scoreData.name = user.name;

  const zsetKey = `contest:${contestId}:leaderboard`;
  const detailKey = `contest:${contestId}:user:${userId}`;

  // If Redis is active, update Redis sorted set and hash
  if (redisClient && process.env.USE_IN_MEMORY_QUEUE !== 'true') {
    try {
      await redisClient.zadd(zsetKey, scoreData.compositeScore, userId.toString());
      await redisClient.set(detailKey, JSON.stringify(scoreData), 'EX', 86400); // 24h TTL
    } catch (err) {
      console.warn(`[Leaderboard] Redis update warning: ${err.message}`);
    }
  }

  // Also update in-memory cache
  if (!inMemoryLeaderboardCache.has(contestId.toString())) {
    inMemoryLeaderboardCache.set(contestId.toString(), new Map());
  }
  inMemoryLeaderboardCache.get(contestId.toString()).set(userId.toString(), scoreData);

  return scoreData;
};

/**
 * Fetch the full ranked leaderboard for a contest
 */
const getContestLeaderboard = async (contestId) => {
  const contest = await Contest.findById(contestId).populate('problems.problemId', 'title slug');
  if (!contest) return [];

  // Check if we can read from in-memory cache or Redis
  let entries = [];

  if (redisClient && process.env.USE_IN_MEMORY_QUEUE !== 'true') {
    try {
      const zsetKey = `contest:${contestId}:leaderboard`;
      // ZREVRANGE returns highest compositeScore first (Most solved, lowest penalty)
      const userIds = await redisClient.zrevrange(zsetKey, 0, -1);

      if (userIds && userIds.length > 0) {
        for (const uid of userIds) {
          const raw = await redisClient.get(`contest:${contestId}:user:${uid}`);
          if (raw) {
            entries.push(JSON.parse(raw));
          }
        }
      }
    } catch (err) {
      console.warn(`[Leaderboard] Redis fetch warning: ${err.message}`);
    }
  }

  // If Redis returned empty or is offline, compute directly from MongoDB
  if (entries.length === 0) {
    const memoryMap = inMemoryLeaderboardCache.get(contestId.toString());
    if (memoryMap && memoryMap.size > 0) {
      entries = Array.from(memoryMap.values());
    } else {
      // Build from participants in MongoDB
     const participants = contest.participants || [];

for (const pId of participants) {
  const u = await User.findById(pId).select('name role');

  // Only students should appear on the contest leaderboard
  if (u && u.role === 'student') {
    const scoreData = await calculateUserScore(contest, pId);
    scoreData.name = u.name;
    entries.push(scoreData);
  }
}
    }
  }

  // Sort by compositeScore descending (Most solved, lowest penalty)
  entries.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks
  const ranked = entries.map((entry, idx) => ({
    rank: idx + 1,
    ...entry,
  }));

  return ranked;
};

/**
 * Recomputes leaderboard and broadcasts live update over WebSocket room `contest:${contestId}`
 */
const refreshAndBroadcastLeaderboard = async (contestId) => {
  try {
    const leaderboard = await getContestLeaderboard(contestId);
    await publishLeaderboardUpdate({
      contestId: contestId.toString(),
      leaderboard,
    });
    console.log(`[Leaderboard] Broadcasted live update for contest: ${contestId}`);
    return leaderboard;
  } catch (err) {
    console.error(`[Leaderboard] Error broadcasting update: ${err.message}`);
  }
};

module.exports = {
  calculateUserScore,
  updateContestantScore,
  getContestLeaderboard,
  refreshAndBroadcastLeaderboard,
  PENALTY_PER_WRONG_ATTEMPT_MINUTES,
  SCORE_MULTIPLIER,
};
