process.env.MOCK_JUDGE0 = 'true';
process.env.USE_IN_MEMORY_QUEUE = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');
const app = require('../src/app');
const { initSocket } = require('../src/socket');
const { User, Problem, TestCase, Contest, Submission } = require('../src/models');
const { getContestLeaderboard } = require('../src/services/leaderboard.service');
const { inMemoryStore } = require('../src/middleware/rateLimiter');

let mongoServer;
let server;
let baseUrl;

const request = async (method, path, body = null, token = null) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const runConcurrencyTests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - High-Concurrency Contest Stress Test');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, description) => {
    if (condition) {
      console.log(`  \x1b[32m✔\x1b[0m ${description}`);
      passed++;
    } else {
      console.error(`  \x1b[31m✖\x1b[0m ${description}`);
      failed++;
    }
  };

  try {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    server = http.createServer(app);
    await initSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;

    // 1. Setup Admin, Problems, and Contest
    console.log('--- Step 1: Setting Up Contest with Problems ---');
    const adminRes = await request('POST', '/auth/register', {
      name: 'Contest Director',
      email: 'director@codejudge.com',
      password: 'password123',
      role: 'admin',
    });
    const adminToken = adminRes.data.data.token;

    const prob1Res = await request(
      'POST',
      '/problems',
      {
        title: 'Concurrent Two Sum',
        statement: 'Find two numbers that add up to target.',
        difficulty: 'easy',
        tags: ['Array'],
        allowedLanguages: ['javascript'],
        testCases: [{ input: '2 7 9', expectedOutput: '9', isHidden: false, order: 1 }],
      },
      adminToken
    );
    const prob1 = prob1Res.data.data.problem;

    const prob2Res = await request(
      'POST',
      '/problems',
      {
        title: 'Concurrent Reverse String',
        statement: 'Reverse the input string.',
        difficulty: 'easy',
        tags: ['String'],
        allowedLanguages: ['javascript'],
        testCases: [{ input: 'hello', expectedOutput: 'olleh', isHidden: false, order: 1 }],
      },
      adminToken
    );
    const prob2 = prob2Res.data.data.problem;

    const now = Date.now();
    const contestRes = await request(
      'POST',
      '/contests',
      {
        name: 'Grand High-Concurrency Collegiate Challenge',
        startTime: new Date(now - 10 * 60 * 1000).toISOString(), // Started 10 min ago
        endTime: new Date(now + 120 * 60 * 1000).toISOString(), // Ends in 2h
        problems: [
          { problemId: prob1._id, points: 100 },
          { problemId: prob2._id, points: 200 },
        ],
      },
      adminToken
    );
    const contest = contestRes.data.data.contest;
    assert(contestRes.status === 201, 'Created live active contest');

    // 2. Register 10 distinct students and join contest simultaneously
    console.log('\n--- Step 2: Registering 10 Students & Concurrent Join ---');
    const NUM_STUDENTS = 10;
    const students = [];

    for (let i = 1; i <= NUM_STUDENTS; i++) {
      const reg = await request('POST', '/auth/register', {
        name: `Student Racer ${i}`,
        email: `racer${i}@codejudge.com`,
        password: `password${i}`,
        role: 'student',
      });
      students.push({
        id: reg.data.data.user.id,
        name: `Student Racer ${i}`,
        token: reg.data.data.token,
      });
    }
    assert(students.length === NUM_STUDENTS, `Successfully registered ${NUM_STUDENTS} students`);

    // All students concurrently join the contest
    const joinPromises = students.map((s) =>
      request('POST', `/contests/${contest._id}/join`, {}, s.token)
    );
    const joinResults = await Promise.all(joinPromises);
    const allJoined = joinResults.every((r) => r.status === 200);
    assert(allJoined, 'All 10 students joined contest concurrently without deadlock');

    // 3. High-Concurrency Submissions
    console.log('\n--- Step 3: Firing Simultaneous Submissions Across Students ---');
    inMemoryStore.clear(); // Clear rate limits for clean concurrency burst

    // Fire Problem 1 submissions concurrently
    const subPromisesProb1 = students.map((s, index) => {
      // First 5 students submit Accepted, remaining 5 submit Wrong Answer
      const code =
        index < 5
          ? 'console.log(9);' // Accepted
          : 'console.log("wrong"); FORCE_WRONG_ANSWER'; // Wrong Answer

      return request(
        'POST',
        '/submissions',
        {
          problemId: prob1._id,
          contestId: contest._id,
          language: 'javascript',
          code,
        },
        s.token
      );
    });

    const prob1Submissions = await Promise.all(subPromisesProb1);
    const allAcceptedToQueue = prob1Submissions.every((r) => r.status === 201);
    assert(allAcceptedToQueue, 'All 10 concurrent submissions accepted into judge queue (201)');

    // Fire Problem 2 submissions concurrently for all students
    const subPromisesProb2 = students.map((s, index) => {
      // Students 0, 1, 2 solve Problem 2 as well
      const code = index < 3 ? 'console.log("olleh");' : 'console.log("no"); FORCE_WRONG_ANSWER';

      return request(
        'POST',
        '/submissions',
        {
          problemId: prob2._id,
          contestId: contest._id,
          language: 'javascript',
          code,
        },
        s.token
      );
    });

    const prob2Submissions = await Promise.all(subPromisesProb2);
    const allProb2Queued = prob2Submissions.every((r) => r.status === 201);
    assert(allProb2Queued, 'Second batch of 10 concurrent submissions accepted (201)');

    // 4. Wait for worker queue to settle
    console.log('\n--- Step 4: Awaiting Judge Pipeline Completion ---');
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Verify all submissions reached Completed status
    const allSubs = await Submission.find({ contestId: contest._id });
    const allCompleted = allSubs.every((s) => s.status === 'Completed');
    assert(allCompleted, `All ${allSubs.length} submissions reached "Completed" state in DB`);

    // 5. Inspect Leaderboard Integrity Under Concurrency
    console.log('\n--- Step 5: Validating Leaderboard Determinism & Race Condition Prevention ---');
    const leaderboard = await getContestLeaderboard(contest._id);
    console.log('Leaderboard:', JSON.stringify(leaderboard, null, 2));

    // CRITICAL: Ensure no duplicate user rows on leaderboard
    const userIdsOnBoard = leaderboard.map((row) => row.userId.toString());
    const uniqueUserIds = new Set(userIdsOnBoard);
    assert(
      userIdsOnBoard.length === uniqueUserIds.size,
      `No duplicate user entries in leaderboard (Total entries: ${leaderboard.length}, Unique users: ${uniqueUserIds.size})`
    );

    // Verify Ranking Logic
    // Top 3 students (indices 0, 1, 2) solved BOTH problems (problemsSolved === 2)
    assert(leaderboard[0].problemsSolved === 2, 'Rank 1 contestant solved 2 problems');
    assert(leaderboard[1].problemsSolved === 2, 'Rank 2 contestant solved 2 problems');
    assert(leaderboard[2].problemsSolved === 2, 'Rank 3 contestant solved 2 problems');

    // Next 2 students (indices 3, 4) solved 1 problem
    assert(leaderboard[3].problemsSolved === 1, 'Rank 4 contestant solved 1 problem');
    assert(leaderboard[4].problemsSolved === 1, 'Rank 5 contestant solved 1 problem');

    // Remaining students solved 0 problems
    const solvedZeroCount = leaderboard.filter((r) => r.problemsSolved === 0).length;
    assert(solvedZeroCount === 5, 'Remaining 5 contestants have 0 solved problems');

    // Ranks are monotonically non-decreasing
    let rankMonotonic = true;
    for (let i = 1; i < leaderboard.length; i++) {
      if (leaderboard[i].rank < leaderboard[i - 1].rank) {
        rankMonotonic = false;
        break;
      }
    }
    assert(rankMonotonic, 'Leaderboard ranks are strictly monotonic (1, 2, 3...)');

    console.log('\n====================================================');
    console.log(`  Concurrency Tests Passed: ${passed} | Failed: ${failed}`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Concurrency test failed with error:', error);
    process.exit(1);
  } finally {
    if (server) server.close();
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
};

runConcurrencyTests();
