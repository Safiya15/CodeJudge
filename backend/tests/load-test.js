process.env.MOCK_JUDGE0 = 'true';
process.env.USE_IN_MEMORY_QUEUE = 'true';
process.env.DISABLE_RATE_LIMIT = 'true';

const autocannon = require('autocannon');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');
const app = require('../src/app');
const { initSocket } = require('../src/socket');
const { User, Problem, Contest, TestCase } = require('../src/models');
const { getQueueCounts } = require('../src/queue/judgeQueue');
const { inMemoryStore } = require('../src/middleware/rateLimiter');

let mongoServer;
let server;
let baseUrl;

const runLoadTest = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - High-Throughput Autocannon Benchmark');
  console.log('====================================================\n');

  try {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    server = http.createServer(app);
    await initSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    console.log(`[LoadTest] Test server active on http://localhost:${port}`);

    // Setup Admin, Problem, TestCase, Contest, and User
    const admin = await User.create({
      name: 'Benchmark Admin',
      email: 'bench_admin@codejudge.com',
      passwordHash: 'dummyhash123',
      role: 'admin',
    });
    const adminToken = admin.generateAuthToken();

    const problem = await Problem.create({
      title: 'Benchmark Load Problem',
      slug: 'benchmark-load-problem',
      statement: 'Echo 42.',
      difficulty: 'easy',
      tags: ['Benchmark'],
      allowedLanguages: ['javascript'],
      createdBy: admin._id,
    });

    await TestCase.create({
      problemId: problem._id,
      input: '1',
      expectedOutput: '42',
      isHidden: false,
      order: 1,
    });

    const now = Date.now();
    const contest = await Contest.create({
      name: 'Autocannon Contest Stress Test',
      startTime: new Date(now - 60000), // Active
      endTime: new Date(now + 3600000),
      problems: [{ problemId: problem._id, points: 100 }],
      createdBy: admin._id,
    });

    const student = await User.create({
      name: 'Load Runner',
      email: 'runner@codejudge.com',
      passwordHash: 'dummyhash123',
      role: 'student',
    });
    const studentToken = student.generateAuthToken();

    // Student joins contest
    contest.participants.push(student._id);
    await contest.save();

    // Disable rate limiter for pure throughput load testing
    inMemoryStore.clear();

    const requestPayload = JSON.stringify({
      problemId: problem._id.toString(),
      contestId: contest._id.toString(),
      language: 'javascript',
      code: 'console.log(42);',
    });

    console.log('[LoadTest] Launching Autocannon: 20 concurrent connections, 10 seconds duration...\n');

    // Sample queue depth during load
    let maxQueueDepth = 0;
    const queueSampler = setInterval(async () => {
      const counts = await getQueueCounts();
      const current = (counts.waiting || 0) + (counts.active || 0);
      if (current > maxQueueDepth) {
        maxQueueDepth = current;
      }
    }, 100);

    const result = await autocannon({
      url: `${baseUrl}/submissions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: requestPayload,
      connections: 20,
      duration: 10, // 10 seconds
      pipelining: 1,
    });

    clearInterval(queueSampler);

    // Give asynchronous queue worker 1 second to drain active executions
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const p95Estimated = result.latency.p97_5 || result.latency.p90;

    console.log('----------------------------------------------------');
    console.log('  AUTOCANNON BENCHMARK RESULTS');
    console.log('----------------------------------------------------');
    console.log(`Total Requests Handled : ${result.requests.total}`);
    console.log(`Average Throughput     : ${result.requests.average} req/sec`);
    console.log(`Peak Throughput        : ${result.requests.max} req/sec`);
    console.log(`Latency (p50)          : ${result.latency.p50} ms`);
    console.log(`Latency (p95 approx)   : ${p95Estimated} ms`);
    console.log(`Latency (p99)          : ${result.latency.p99} ms`);
    console.log(`Max Request Latency    : ${result.latency.max} ms`);
    console.log(`Non-2xx / Errors       : ${result.non2xx} errors`);
    console.log(`Peak Measured Queue Depth : ${maxQueueDepth} jobs`);
    console.log('----------------------------------------------------\n');

    return {
      totalRequests: result.requests.total,
      throughputAvg: result.requests.average,
      throughputMax: result.requests.max,
      latencyP50: result.latency.p50,
      latencyP95: p95Estimated,
      latencyP99: result.latency.p99,
      latencyMax: result.latency.max,
      errors: result.non2xx,
      peakQueueDepth: maxQueueDepth,
    };
  } catch (err) {
    console.error('Load test encountered error:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
};

if (require.main === module) {
  runLoadTest();
}

module.exports = { runLoadTest };
