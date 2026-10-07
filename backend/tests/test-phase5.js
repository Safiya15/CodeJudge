process.env.MOCK_JUDGE0 = 'true';
process.env.USE_IN_MEMORY_QUEUE = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');
const { io: ClientIO } = require('socket.io-client');
const app = require('../src/app');
const { initSocket } = require('../src/socket');
const { User, Problem, TestCase, Submission } = require('../src/models');
const { publishSubmissionUpdate } = require('../src/services/eventBus.service');

let mongoServer;
let server;
let baseUrl;
let ioInstance;

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

const runPhase5Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 5 Automated Test Suite');
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
    ioInstance = await initSocket(server);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    console.log('--- Setup: Users and Auth Tokens ---');
    const user1Res = await request('POST', '/auth/register', {
      name: 'User One',
      email: 'user1.ws@codejudge.com',
      password: 'password123',
    });
    const user1Token = user1Res.data.data.token;
    const user1Id = user1Res.data.data.user._id;

    const user2Res = await request('POST', '/auth/register', {
      name: 'User Two',
      email: 'user2.ws@codejudge.com',
      password: 'password123',
    });
    const user2Token = user2Res.data.data.token;
    const user2Id = user2Res.data.data.user._id;

    console.log('\n--- Section A: WebSocket JWT Authentication & Handshake ---');
    // 1. Connection without token should be rejected
    const unauthError = await new Promise((resolve) => {
      const socket = ClientIO(baseUrl, {
        transports: ['websocket'],
        reconnection: false,
      });
      socket.on('connect_error', (err) => {
        socket.close();
        resolve(err.message);
      });
    });
    assert(
      unauthError.includes('Authentication error'),
      'WebSocket handshake rejects connection without JWT token'
    );

    // 2. Connection with invalid token should be rejected
    const invalidTokenError = await new Promise((resolve) => {
      const socket = ClientIO(baseUrl, {
        auth: { token: 'invalid.jwt.token' },
        transports: ['websocket'],
        reconnection: false,
      });
      socket.on('connect_error', (err) => {
        socket.close();
        resolve(err.message);
      });
    });
    assert(
      invalidTokenError.includes('Authentication error'),
      'WebSocket handshake rejects connection with invalid/malformed token'
    );

    // 3. User 1 connects with valid token
    const socket1 = ClientIO(baseUrl, {
      auth: { token: user1Token },
      transports: ['websocket'],
    });
    clientSockets.push(socket1);

    await new Promise((resolve, reject) => {
      socket1.on('connect', resolve);
      socket1.on('connect_error', reject);
    });
    assert(socket1.connected, 'User 1 successfully connects to WebSocket with valid JWT');

    // 4. User 2 connects with valid token
    const socket2 = ClientIO(baseUrl, {
      auth: { token: user2Token },
      transports: ['websocket'],
    });
    clientSockets.push(socket2);

    await new Promise((resolve, reject) => {
      socket2.on('connect', resolve);
      socket2.on('connect_error', reject);
    });
    assert(socket2.connected, 'User 2 successfully connects to WebSocket with valid JWT');

    console.log('\n--- Section B: Targeted Real-time Verdict Delivery ---');
    // Listen for verdict events on both sockets
    let user1ReceivedEvent = null;
    let user2ReceivedEvent = null;

    socket1.on('submission:update', (data) => {
      user1ReceivedEvent = data;
    });

    socket2.on('submission:update', (data) => {
      user2ReceivedEvent = data;
    });

    // Publish update intended for User 1
    const testPayload = {
      submissionId: 'test-sub-123',
      userId: user1Id.toString(),
      status: 'Completed',
      verdict: 'Accepted',
      runtimeMs: 45,
      memoryKb: 3120,
      failedTestIndex: null,
    };

    await publishSubmissionUpdate(testPayload);

    // Give 200ms for event propagation
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert(user1ReceivedEvent != null, 'User 1 received real-time submission:update event');
    assert(
      user1ReceivedEvent.verdict === 'Accepted' && user1ReceivedEvent.runtimeMs === 45,
      'User 1 received exact verdict payload with runtime/memory metrics'
    );
    assert(
      user2ReceivedEvent === null,
      'CRITICAL SECURITY: User 2 did NOT receive User 1 private submission event'
    );

    console.log('\n--- Section C: End-to-End Submit -> Worker -> WebSocket Push ---');
    // Setup problem and test case
    const problem = await Problem.create({
      title: 'Real-time Sum',
      slug: 'realtime-sum',
      statement: 'Add numbers.',
      allowedLanguages: ['python'],
      timeLimitMs: 1000,
      memoryLimitMb: 128,
      createdBy: user1Id,
    });

    await TestCase.create({
      problemId: problem._id,
      input: '5',
      expectedOutput: '10',
      isHidden: false,
      order: 1,
    });

    // Listen for events emitted during submission pipeline
    const liveEvents = [];
    socket1.on('submission:update', (evt) => {
      liveEvents.push(evt);
    });

    // Submit code via POST /submissions
    const submitRes = await request(
      'POST',
      '/submissions',
      {
        problemId: problem._id,
        language: 'python',
        code: 'print("10")',
      },
      user1Token
    );

    assert(submitRes.status === 201, 'POST /submissions accepted and queued');
    const createdSubId = submitRes.data.data.submissionId;

    // Wait for worker to judge and emit live updates over WebSocket
    await new Promise((resolve) => setTimeout(resolve, 350));

    const finalEvent = liveEvents.find(
      (e) => e.submissionId === createdSubId && e.status === 'Completed'
    );
    assert(finalEvent != null, 'WebSocket received Completed event from worker pipeline');
    assert(finalEvent.verdict === 'Accepted', 'Live verdict is Accepted');
    assert(finalEvent.runtimeMs >= 0, 'Live event includes runtime metric');

    console.log('\n====================================================');
    console.log(`  Phase 5 Results: ${passed} passed, ${failed} failed`);
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

runPhase5Tests();
