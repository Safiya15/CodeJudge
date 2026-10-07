process.env.MOCK_JUDGE0 = 'true';
process.env.USE_IN_MEMORY_QUEUE = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');
const app = require('../src/app');
const { initSocket } = require('../src/socket');
const { User, Problem, TestCase, Submission } = require('../src/models');
const { inMemoryStore } = require('../src/middleware/rateLimiter');

let mongoServer;
let server;
let baseUrl;

const request = async (method, path, body = null, token = null, headers = {}) => {
  const reqHeaders = { 'Content-Type': 'application/json', ...headers };
  if (token) reqHeaders['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawHeaders = res.headers;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: rawHeaders };
};

const runPhase7Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 7 Automated Test Suite');
  console.log('  Rate Limiting, Hidden-Test Protection & Security');
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

    // 1. Setup users
    console.log('--- Setup: Users and Problems ---');
    const adminRes = await request('POST', '/auth/register', {
      name: 'Security Admin',
      email: 'sec_admin@codejudge.com',
      password: 'adminPassword123',
      role: 'admin',
    });
    const adminToken = adminRes.data.data.token;
    assert(adminRes.status === 201, 'Registered security admin');

    const studentARes = await request('POST', '/auth/register', {
      name: 'Student Alice',
      email: 'alice@codejudge.com',
      password: 'alicePassword123',
      role: 'student',
    });
    const studentAToken = studentARes.data.data.token;
    const studentAId = studentARes.data.data.user.id;
    assert(studentARes.status === 201, 'Registered Student Alice');

    const studentBRes = await request('POST', '/auth/register', {
      name: 'Student Bob',
      email: 'bob@codejudge.com',
      password: 'bobPassword123',
      role: 'student',
    });
    const studentBToken = studentBRes.data.data.token;
    assert(studentBRes.status === 201, 'Registered Student Bob');

    // Create problem with sample and hidden test cases
    const problemRes = await request(
      'POST',
      '/problems',
      {
        title: 'Secret Formula Problem',
        statement: 'Compute the secret output from input.',
        difficulty: 'Medium',
        tags: ['Math', 'Security'],
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        allowedLanguages: ['javascript', 'python', 'cpp'],
        testCases: [
          { input: '10', expectedOutput: '20', isHidden: false, order: 1 },
          { input: '50', expectedOutput: '100', isHidden: false, order: 2 },
          { input: '999', expectedOutput: '1998', isHidden: true, order: 3 },
          { input: '9999', expectedOutput: '19998', isHidden: true, order: 4 },
        ],
      },
      adminToken
    );
    const problem = problemRes.data.data.problem;
    assert(problemRes.status === 201, 'Created problem with 2 sample and 2 hidden test cases');

    // 2. Hidden Test Case Protection
    console.log('\n--- Test Suite 1: Hidden-Test Case Protection ---');
    const publicProblemRes = await request('GET', `/problems/${problem.slug}`);
    assert(publicProblemRes.status === 200, 'Public GET /problems/:slug succeeded');
    const returnedCases = publicProblemRes.data.data.problem.sampleTestCases;
    assert(returnedCases.length === 2, 'Only 2 test cases returned to client');
    const hasHidden = returnedCases.some((tc) => tc.input === '999' || tc.input === '9999');
    assert(!hasHidden, 'Hidden test cases are NEVER exposed in public problem endpoint');

    // Verify /run runs only on samples
    const runRes = await request(
      'POST',
      '/run',
      {
        problemId: problem._id,
        language: 'javascript',
        code: 'const fs = require("fs"); const x = parseInt(fs.readFileSync(0, "utf-8").trim()); console.log(x * 2);',
      },
      studentAToken
    );
    assert(runRes.status === 200, 'POST /run succeeded');
    assert(
      runRes.data.data.results.length === 2,
      'POST /run strictly executed only sample cases (count = 2)'
    );

    // 3. Competitor Source Code Concealment
    console.log('\n--- Test Suite 2: Competitor Source Code Protection ---');
    const submissionRes = await request(
      'POST',
      '/submissions',
      {
        problemId: problem._id,
        language: 'javascript',
        code: '// Alice top-secret proprietary algorithm\nconsole.log(42);',
      },
      studentAToken
    );
    assert(submissionRes.status === 201, 'Student Alice submitted code');
    const submissionId = submissionRes.data.data.submissionId;

    // Alice views her own submission -> code must be present
    const aliceViewRes = await request('GET', `/submissions/${submissionId}`, null, studentAToken);
    assert(aliceViewRes.status === 200, 'Alice fetched her own submission');
    assert(
      aliceViewRes.data.data.submission.code.includes('top-secret'),
      'Submission author CAN view their submitted code'
    );

    // Bob views Alice's submission -> code must NOT be present
    const bobViewRes = await request('GET', `/submissions/${submissionId}`, null, studentBToken);
    assert(bobViewRes.status === 200, 'Bob fetched Alice submission info');
    assert(
      bobViewRes.data.data.submission.code === undefined,
      'Competitor Bob CANNOT view Alice submitted code (field omitted/deleted)'
    );

    // Admin views Alice's submission -> code must be present
    const adminViewRes = await request('GET', `/submissions/${submissionId}`, null, adminToken);
    assert(adminViewRes.status === 200, 'Admin fetched Alice submission info');
    assert(
      adminViewRes.data.data.submission.code.includes('top-secret'),
      'Admin CAN view all competitor code for grading/moderation'
    );

    // Submissions list excludes code for all users
    const listRes = await request('GET', `/submissions?problemId=${problem._id}`, null, studentBToken);
    assert(listRes.status === 200, 'Fetched submissions list');
    const listHasCode = listRes.data.data.submissions.some((s) => s.code !== undefined);
    assert(!listHasCode, 'GET /submissions list strictly excludes code payload');

    // 4. Input Validation & Body/Code Size Capping
    console.log('\n--- Test Suite 3: Input Validation & Code Size Limits ---');
    // Missing required fields
    const invalidSubRes = await request(
      'POST',
      '/submissions',
      { problemId: problem._id },
      studentAToken
    );
    assert(invalidSubRes.status === 400, 'Rejects submission with missing fields (400)');

    // Oversized code (> 64 KB)
    const largeCode = 'a'.repeat(65 * 1024); // 65 KB
    const oversizedSubRes = await request(
      'POST',
      '/submissions',
      {
        problemId: problem._id,
        language: 'javascript',
        code: largeCode,
      },
      studentAToken
    );
    assert(oversizedSubRes.status === 400, 'Rejects code larger than 64KB on /submissions');
    assert(
      oversizedSubRes.data.error.includes('Code size exceeds maximum limit'),
      'Returns descriptive code size limit error message'
    );

    const oversizedRunRes = await request(
      'POST',
      '/run',
      {
        problemId: problem._id,
        language: 'javascript',
        code: largeCode,
      },
      studentAToken
    );
    assert(oversizedRunRes.status === 400, 'Rejects code larger than 64KB on /run');

    // 5. Rate Limiting Tests (Login, Run, Submit)
    console.log('\n--- Test Suite 4: Rate Limiting & Retry-After Headers ---');
    // Clean memory store for clean rate limit assertions
    inMemoryStore.clear();

    // Test Login Rate Limiting (5 requests per IP)
    const customIp = '198.51.100.42';
    const loginHeaders = { 'x-forwarded-for': customIp };

    for (let i = 1; i <= 5; i++) {
      const res = await request(
        'POST',
        '/auth/login',
        { email: 'nonexistent@codejudge.com', password: 'wrong' },
        null,
        loginHeaders
      );
      assert(res.status === 401, `Login attempt ${i}/5 returned 401 (under limit)`);
    }

    // 6th attempt should be blocked by rate limiter (429)
    const blockedLoginRes = await request(
      'POST',
      '/auth/login',
      { email: 'nonexistent@codejudge.com', password: 'wrong' },
      null,
      loginHeaders
    );
    assert(blockedLoginRes.status === 429, '6th login attempt from same IP returned 429 Too Many Requests');
    assert(
      blockedLoginRes.headers.get('retry-after') !== null,
      `429 response contains Retry-After header: ${blockedLoginRes.headers.get('retry-after')}s`
    );
    assert(
      blockedLoginRes.data.retryAfter !== undefined,
      'Response body includes retryAfter numeric field'
    );

    // Test Submission Rate Limiting (5 submissions per user)
    // Register fresh user for submission rate limit test
    const rateLimitUserRes = await request('POST', '/auth/register', {
      name: 'Speedy Submitter',
      email: 'speedy@codejudge.com',
      password: 'password123',
      role: 'student',
    });
    const speedyToken = rateLimitUserRes.data.data.token;

    for (let i = 1; i <= 5; i++) {
      const res = await request(
        'POST',
        '/submissions',
        {
          problemId: problem._id,
          language: 'javascript',
          code: `console.log(${i});`,
        },
        speedyToken
      );
      assert(res.status === 201, `Submission ${i}/5 accepted (under limit)`);
    }

    // 6th submission within 1 minute from the same user should return 429
    const blockedSubRes = await request(
      'POST',
      '/submissions',
      {
        problemId: problem._id,
        language: 'javascript',
        code: 'console.log(6);',
      },
      speedyToken
    );
    assert(blockedSubRes.status === 429, '6th submission from same user returned 429');
    assert(
      blockedSubRes.headers.get('retry-after') !== null,
      `429 submission contains Retry-After header: ${blockedSubRes.headers.get('retry-after')}s`
    );
    assert(
      blockedSubRes.data.error.includes('Submission limit exceeded'),
      'Returns clear submission rate limit message'
    );

    // 6. Security Headers Check (Helmet)
    console.log('\n--- Test Suite 5: Security Headers (Helmet & CORS) ---');
    const healthCheckRes = await request('GET', '/health');
    assert(
      healthCheckRes.headers.get('x-content-type-options') === 'nosniff',
      'Helmet active: X-Content-Type-Options is nosniff'
    );
    assert(
      healthCheckRes.headers.get('x-frame-options') === 'SAMEORIGIN' ||
        healthCheckRes.headers.get('x-frame-options') === 'DENY',
      'Helmet active: X-Frame-Options configured against clickjacking'
    );

    console.log('\n====================================================');
    console.log(`  Tests Passed: ${passed} | Failed: ${failed}`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Test execution failed with error:', error);
    process.exit(1);
  } finally {
    if (server) server.close();
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
};

runPhase7Tests();
