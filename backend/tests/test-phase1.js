const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { User, Problem, TestCase, Contest, Submission } = require('../src/models');
const http = require('http');

let mongoServer;
let server;
let baseUrl;

// Simple HTTP request helper using native fetch
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

const runTests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 1 Automated Test Suite');
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
    // 1. Setup in-memory MongoDB
    console.log('[Setup] Starting in-memory MongoDB server...');
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    console.log('[Setup] Connected to in-memory MongoDB.\n');

    // 2. Start HTTP server on dynamic port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    console.log('--- Section A: Health & Root Endpoints ---');
    const healthRes = await request('GET', '/health');
    assert(healthRes.status === 200, 'GET /health returns 200 OK');
    assert(healthRes.data.services.database === 'connected', 'Database reported as connected');

    console.log('\n--- Section B: User Registration & Password Hashing ---');
    const studentPayload = {
      name: 'Alice Student',
      email: 'alice@college.edu',
      password: 'password123',
      role: 'student',
    };
    const regRes = await request('POST', '/auth/register', studentPayload);
    assert(regRes.status === 201, 'POST /auth/register creates new student (201)');
    assert(regRes.data.data.token != null, 'Registration returns JWT token');
    assert(regRes.data.data.user.passwordHash === undefined, 'passwordHash is stripped from response');
    assert(regRes.data.data.user.role === 'student', 'User role assigned as student');

    const duplicateRes = await request('POST', '/auth/register', studentPayload);
    assert(duplicateRes.status === 400, 'Duplicate email registration returns 400 Bad Request');

    const shortPassRes = await request('POST', '/auth/register', {
      name: 'Bob',
      email: 'bob@college.edu',
      password: '123',
    });
    assert(shortPassRes.status === 400, 'Password under 6 characters rejected with 400');

    console.log('\n--- Section C: User Login & Authentication ---');
    const loginRes = await request('POST', '/auth/login', {
      email: 'alice@college.edu',
      password: 'password123',
    });
    assert(loginRes.status === 200, 'POST /auth/login with valid credentials returns 200');
    assert(loginRes.data.data.token != null, 'Login returns JWT token');
    const studentToken = loginRes.data.data.token;

    const invalidPassRes = await request('POST', '/auth/login', {
      email: 'alice@college.edu',
      password: 'wrongpassword',
    });
    assert(invalidPassRes.status === 401, 'POST /auth/login with wrong password returns 401');

    console.log('\n--- Section D: Role-Based Access Control (RBAC) ---');
    // Register an admin user
    const adminRegRes = await request('POST', '/auth/register', {
      name: 'Prof. Turing',
      email: 'turing@college.edu',
      password: 'adminpassword123',
      role: 'admin',
    });
    assert(adminRegRes.status === 201, 'Admin account registered successfully');
    const adminToken = adminRegRes.data.data.token;

    // Test GET /auth/me
    const meRes = await request('GET', '/auth/me', null, studentToken);
    assert(meRes.status === 200, 'GET /auth/me returns 200 with valid token');
    assert(meRes.data.data.user.email === 'alice@college.edu', 'GET /auth/me returns correct user data');

    const meNoTokenRes = await request('GET', '/auth/me');
    assert(meNoTokenRes.status === 401, 'GET /auth/me without token returns 401');

    // Test admin-only route
    const adminCheckWithStudent = await request('GET', '/auth/admin-check', null, studentToken);
    assert(
      adminCheckWithStudent.status === 403,
      'Student accessing admin route is rejected with 403 Forbidden'
    );

    const adminCheckWithAdmin = await request('GET', '/auth/admin-check', null, adminToken);
    assert(adminCheckWithAdmin.status === 200, 'Admin accessing admin route succeeds with 200 OK');

    console.log('\n--- Section E: MongoDB Data Models Validation ---');
    // Problem Model
    const problem = await Problem.create({
      title: 'Two Sum',
      slug: 'two-sum',
      statement: '# Two Sum\nFind two numbers that add up to target.',
      difficulty: 'easy',
      tags: ['arrays', 'hash-table'],
      timeLimitMs: 1000,
      memoryLimitMb: 128,
      allowedLanguages: ['cpp', 'python', 'java', 'javascript'],
      createdBy: adminRegRes.data.data.user._id,
    });
    assert(problem._id != null && problem.slug === 'two-sum', 'Problem model creates and validates');

    // TestCase Model
    const sampleTestCase = await TestCase.create({
      problemId: problem._id,
      input: '4\n2 7 11 15\n9',
      expectedOutput: '0 1',
      isHidden: false,
      order: 1,
    });
    const hiddenTestCase = await TestCase.create({
      problemId: problem._id,
      input: '3\n3 2 4\n6',
      expectedOutput: '1 2',
      isHidden: true,
      order: 2,
    });
    assert(sampleTestCase._id != null && !sampleTestCase.isHidden, 'Sample test case created');
    assert(hiddenTestCase._id != null && hiddenTestCase.isHidden, 'Hidden test case created');

    // Contest Model
    const contest = await Contest.create({
      name: 'Spring Coding Challenge 2026',
      startTime: new Date(Date.now() + 3600000), // starts in 1 hour
      endTime: new Date(Date.now() + 7200000),   // ends in 2 hours
      problems: [{ problemId: problem._id, points: 100 }],
      participants: [regRes.data.data.user._id],
      createdBy: adminRegRes.data.data.user._id,
    });
    assert(contest._id != null && contest.problems.length === 1, 'Contest model creates with problem points');

    // Submission Model
    const submission = await Submission.create({
      userId: regRes.data.data.user._id,
      problemId: problem._id,
      contestId: contest._id,
      language: 'cpp',
      code: '#include <iostream>\nint main() { return 0; }',
      status: 'Pending',
    });
    assert(
      submission._id != null && submission.status === 'Pending' && submission.verdict === null,
      'Submission model initializes with Pending status and null verdict'
    );

    console.log('\n====================================================');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('====================================================\n');
  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    process.exit(failed > 0 ? 1 : 0);
  }
};

runTests();
