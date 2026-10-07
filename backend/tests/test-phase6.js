process.env.MOCK_JUDGE0 = 'true';
process.env.USE_IN_MEMORY_QUEUE = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');
const { io: ClientIO } = require('socket.io-client');
const app = require('../src/app');
const { initSocket } = require('../src/socket');
const { User, Problem, TestCase, Contest, Submission } = require('../src/models');
const { judgeProcessor } = require('../src/workers/judgeProcessor');
const {
  calculateUserScore,
  getContestLeaderboard,
  updateContestantScore,
} = require('../src/services/leaderboard.service');

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

const runPhase6Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 6 Automated Test Suite');
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

  const clientSockets = [];

  try {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    server = http.createServer(app);
    await initSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;

    console.log('--- Setup: Users and Problems ---');
    const adminRes = await request('POST', '/auth/register', {
      name: 'Contest Admin',
      email: 'admin.contest@codejudge.com',
      password: 'password123',
      role: 'admin',
    });
    const adminToken = adminRes.data.data.token;
    const adminId = adminRes.data.data.user._id;

    const studentARes = await request('POST', '/auth/register', {
      name: 'Alice Contestant',
      email: 'alice.contest@codejudge.com',
      password: 'password123',
      role: 'student',
    });
    const studentAToken = studentARes.data.data.token;
    const studentAId = studentARes.data.data.user._id;

    const studentBRes = await request('POST', '/auth/register', {
      name: 'Bob Contestant',
      email: 'bob.contest@codejudge.com',
      password: 'password123',
      role: 'student',
    });
    const studentBToken = studentBRes.data.data.token;
    const studentBId = studentBRes.data.data.user._id;

    const prob1 = await Problem.create({
      title: 'Contest Problem 1',
      slug: 'contest-prob-1',
      statement: 'Problem 1 statement',
      allowedLanguages: ['python'],
      createdBy: adminId,
    });
    await TestCase.create({
      problemId: prob1._id,
      input: '1',
      expectedOutput: '1',
      isHidden: false,
      order: 1,
    });

    const prob2 = await Problem.create({
      title: 'Contest Problem 2',
      slug: 'contest-prob-2',
      statement: 'Problem 2 statement',
      allowedLanguages: ['python'],
      createdBy: adminId,
    });
    await TestCase.create({
      problemId: prob2._id,
      input: '2',
      expectedOutput: '2',
      isHidden: false,
      order: 1,
    });

    console.log('\n--- Section A: Contest Creation & Lifecycle API ---');
    // 1. Student cannot create contest
    const studentCreate = await request(
      'POST',
      '/contests',
      {
        name: 'Hacker Cup',
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(Date.now() + 3600000),
      },
      studentAToken
    );
    assert(studentCreate.status === 403, 'Student creating contest is blocked (403 Forbidden)');

    // 2. Invalid date check (start >= end)
    const invalidDates = await request(
      'POST',
      '/contests',
      {
        name: 'Bad Dates Contest',
        startTime: new Date(Date.now() + 3600000),
        endTime: new Date(Date.now()),
      },
      adminToken
    );
    assert(invalidDates.status === 400, 'Rejects contest with startTime >= endTime');

    // 3. Admin creates an active Live contest
    const now = Date.now();
    const liveContestRes = await request(
      'POST',
      '/contests',
      {
        name: 'Spring Code Sprint 2026',
        startTime: new Date(now - 1800000), // Started 30 mins ago
        endTime: new Date(now + 3600000),   // Ends in 60 mins
        problems: [
          { problemId: prob1._id, points: 100 },
          { problemId: prob2._id, points: 200 },
        ],
      },
      adminToken
    );
    assert(liveContestRes.status === 201, 'Admin creates Live contest (201)');
    const liveContestId = liveContestRes.data.data.contest._id;

    // 4. Admin creates an Upcoming contest
    const upcomingContestRes = await request(
      'POST',
      '/contests',
      {
        name: 'Summer Invitational',
        startTime: new Date(now + 7200000),  // Starts in 2h
        endTime: new Date(now + 14400000),  // Ends in 4h
        problems: [{ problemId: prob1._id, points: 100 }],
      },
      adminToken
    );
    const upcomingContestId = upcomingContestRes.data.data.contest._id;

    // 5. Admin creates an Ended contest
    const endedContestRes = await request(
      'POST',
      '/contests',
      {
        name: 'Winter Warmup (Past)',
        startTime: new Date(now - 7200000), // Started 2h ago
        endTime: new Date(now - 3600000),   // Ended 1h ago
        problems: [{ problemId: prob1._id, points: 100 }],
      },
      adminToken
    );
    const endedContestId = endedContestRes.data.data.contest._id;

    // 6. List contests and check dynamic status tags
    const listRes = await request('GET', '/contests');
    assert(listRes.status === 200, 'GET /contests returns 200');
    const returnedContests = listRes.data.data.contests;
    const liveItem = returnedContests.find((c) => c._id === liveContestId);
    const upcomingItem = returnedContests.find((c) => c._id === upcomingContestId);
    const endedItem = returnedContests.find((c) => c._id === endedContestId);
    assert(liveItem.status === 'Live', 'Dynamic status correctly computed as Live');
    assert(upcomingItem.status === 'Upcoming', 'Dynamic status correctly computed as Upcoming');
    assert(endedItem.status === 'Ended', 'Dynamic status correctly computed as Ended');

    // 7. Student registers for Live contest
    const joinRes = await request('POST', `/contests/${liveContestId}/join`, null, studentAToken);
    assert(joinRes.status === 200, 'Student A joins contest successfully');
    await request('POST', `/contests/${liveContestId}/join`, null, studentBToken);

    console.log('\n--- Section B: Server-Time Contest Window Enforcement ---');
    // 8. Reject submission if student hasn't joined
    const unjoinedStudentRes = await request('POST', '/auth/register', {
      name: 'Unjoined Dan',
      email: 'dan@codejudge.com',
      password: 'password123',
    });
    const unjoinedToken = unjoinedStudentRes.data.data.token;
    const unjoinedSub = await request(
      'POST',
      '/submissions',
      { problemId: prob1._id, contestId: liveContestId, language: 'python', code: 'print("1")' },
      unjoinedToken
    );
    assert(unjoinedSub.status === 403, 'Rejects contest submission if user has not joined (403)');

    // 9. Reject submission on Upcoming contest (has not started)
    await request('POST', `/contests/${upcomingContestId}/join`, null, studentAToken);
    const upcomingSub = await request(
      'POST',
      '/submissions',
      { problemId: prob1._id, contestId: upcomingContestId, language: 'python', code: 'print("1")' },
      studentAToken
    );
    assert(upcomingSub.status === 400, 'Rejects submission on contest that has not started yet (400)');

    // 10. Reject submission on Ended contest (closed)
    await request('POST', `/contests/${endedContestId}/join`, null, studentAToken);
    const endedSub = await request(
      'POST',
      '/submissions',
      { problemId: prob1._id, contestId: endedContestId, language: 'python', code: 'print("1")' },
      studentAToken
    );
    assert(endedSub.status === 400, 'Rejects submission on contest that has already ended (400)');

    // 11. Practice mode: submissions with no contestId are allowed anytime
    const practiceSub = await request(
      'POST',
      '/submissions',
      { problemId: prob1._id, language: 'python', code: 'print("1")' },
      studentAToken
    );
    assert(practiceSub.status === 201, 'Practice mode (no contestId) accepts submission anytime');

    console.log('\n--- Section C: ICPC Penalty Scoring & Live Leaderboard ---');
    // Let's create submissions inside the Live contest window for Alice and Bob
    const contestStartMs = new Date(now - 1800000).getTime();

    // Alice:
    // Solves Problem 1 at minute 10 (contestStart + 10 mins) with 0 wrong attempts
    const subAliceP1 = await Submission.create({
      userId: studentAId,
      problemId: prob1._id,
      contestId: liveContestId,
      language: 'python',
      code: 'print("1")',
      status: 'Completed',
      verdict: 'Accepted',
      createdAt: new Date(contestStartMs + 10 * 60000),
    });

    // Bob:
    // Submits Wrong Answer on Problem 1 at minute 5
    await Submission.create({
      userId: studentBId,
      problemId: prob1._id,
      contestId: liveContestId,
      language: 'python',
      code: 'FORCE_WRONG_ANSWER',
      status: 'Completed',
      verdict: 'Wrong Answer',
      createdAt: new Date(contestStartMs + 5 * 60000),
    });

    // Solves Problem 1 at minute 15 (1 wrong attempt before AC)
    const subBobP1 = await Submission.create({
      userId: studentBId,
      problemId: prob1._id,
      contestId: liveContestId,
      language: 'python',
      code: 'print("1")',
      status: 'Completed',
      verdict: 'Accepted',
      createdAt: new Date(contestStartMs + 15 * 60000),
    });

    // Update leaderboard in Redis / memory
    await updateContestantScore(liveContestId, studentAId);
    await updateContestantScore(liveContestId, studentBId);

    const contestLiveDoc = await Contest.findById(liveContestId);
    const scoreA = await calculateUserScore(contestLiveDoc, studentAId);
    const scoreB = await calculateUserScore(contestLiveDoc, studentBId);

    // Alice: 1 solved, 10 min penalty
    assert(scoreA.problemsSolved === 1, 'Alice has 1 problem solved');
    assert(scoreA.totalPenalty === 10, 'Alice has 10 min penalty (solveTime=10, wrongAttempts=0)');

    // Bob: 1 solved, 15 solveTime + 20 wrong attempt penalty = 35 min penalty
    assert(scoreB.problemsSolved === 1, 'Bob has 1 problem solved');
    assert(scoreB.totalPenalty === 35, 'Bob has 35 min penalty (solveTime=15 + 20 penalty)');

    // Check rankings: Alice should rank #1 because 10 < 35 penalty
    const leaderboard1 = await getContestLeaderboard(liveContestId);
    assert(leaderboard1[0].userId === studentAId.toString(), 'Alice ranks #1 (lower penalty time tie-break)');
    assert(leaderboard1[1].userId === studentBId.toString(), 'Bob ranks #2');

    // Now Bob solves Problem 2 at minute 20!
    await Submission.create({
      userId: studentBId,
      problemId: prob2._id,
      contestId: liveContestId,
      language: 'python',
      code: 'print("2")',
      status: 'Completed',
      verdict: 'Accepted',
      createdAt: new Date(contestStartMs + 20 * 60000),
    });

    await updateContestantScore(liveContestId, studentBId);
    const leaderboard2 = await getContestLeaderboard(liveContestId);

    // Bob now has 2 problems solved! He must jump to #1 regardless of penalty
    assert(leaderboard2[0].userId === studentBId.toString(), 'Bob takes Rank #1 with 2 problems solved');
    assert(leaderboard2[0].problemsSolved === 2, 'Bob solvedCount is 2');
    assert(leaderboard2[1].userId === studentAId.toString(), 'Alice drops to Rank #2 with 1 problem solved');

    console.log('\n--- Section D: Live WebSocket Leaderboard Push ---');
    // Connect client socket and join contest room
    const contestSocket = ClientIO(baseUrl, {
      auth: { token: studentAToken },
      transports: ['websocket'],
    });
    clientSockets.push(contestSocket);

    await new Promise((resolve) => contestSocket.on('connect', resolve));
    contestSocket.emit('join:contest', liveContestId.toString());

    let receivedLeaderboardUpdate = null;
    contestSocket.on('leaderboard:update', (data) => {
      receivedLeaderboardUpdate = data;
    });

    // Alice solves Problem 2 as well through the worker pipeline!
    const subAliceP2 = await Submission.create({
      userId: studentAId,
      problemId: prob2._id,
      contestId: liveContestId,
      language: 'python',
      code: 'print("2")',
      status: 'Pending',
    });

    // Run worker
    await judgeProcessor({
      data: { submissionId: subAliceP2._id },
      id: 'job-contest-p2',
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    assert(
      receivedLeaderboardUpdate != null,
      'WebSocket received live leaderboard:update event on contest solve'
    );
    assert(
      receivedLeaderboardUpdate.contestId === liveContestId.toString(),
      'Event belongs to correct contest room'
    );
    assert(
      Array.isArray(receivedLeaderboardUpdate.leaderboard),
      'Leaderboard update delivers ranked array'
    );

    console.log('\n====================================================');
    console.log(`  Phase 6 Results: ${passed} passed, ${failed} failed`);
    console.log('====================================================\n');
  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    for (const s of clientSockets) {
      if (s.connected) s.close();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    process.exit(failed > 0 ? 1 : 0);
  }
};

runPhase6Tests();
