const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { User, Problem, TestCase } = require('../src/models');
const http = require('http');
const path = require('path');
const fs = require('fs');

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

const runPhase2Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 2 Automated Test Suite');
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
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;

    // 1. Setup student and admin users
    console.log('--- Setup: Creating Auth Tokens ---');
    const studentRes = await request('POST', '/auth/register', {
      name: 'Student Sam',
      email: 'student@codejudge.com',
      password: 'password123',
      role: 'student',
    });
    const studentToken = studentRes.data.data.token;

    const adminRes = await request('POST', '/auth/register', {
      name: 'Admin Ann',
      email: 'admin@codejudge.com',
      password: 'adminpassword123',
      role: 'admin',
    });
    const adminToken = adminRes.data.data.token;
    const adminId = adminRes.data.data.user._id;

    console.log('\n--- Section A: Problem Creation & RBAC ---');
    const newProblem = {
      title: 'Fibonacci Number',
      statement: 'Compute the nth Fibonacci number.',
      difficulty: 'easy',
      tags: ['math', 'dp'],
      timeLimitMs: 1000,
      memoryLimitMb: 128,
      testCases: [
        { input: '2', expectedOutput: '1', isHidden: false, order: 1 },
        { input: '4', expectedOutput: '3', isHidden: false, order: 2 },
        { input: '10', expectedOutput: '55', isHidden: true, order: 3 },
      ],
    };

    // Anonymous should be rejected with 401
    const unauthCreate = await request('POST', '/problems', newProblem);
    assert(unauthCreate.status === 401, 'POST /problems rejects unauthenticated requests (401)');

    // Student should be rejected with 403
    const studentCreate = await request('POST', '/problems', newProblem, studentToken);
    assert(studentCreate.status === 403, 'POST /problems rejects student requests (403)');

    // Admin should succeed with 201
    const adminCreate = await request('POST', '/problems', newProblem, adminToken);
    assert(adminCreate.status === 201, 'POST /problems creates problem for admin (201)');
    const createdProblemId = adminCreate.data.data.problem._id;
    assert(createdProblemId != null, 'Created problem has valid ID');
    assert(adminCreate.data.data.problem.slug === 'fibonacci-number', 'Auto-generated slug correctly');

    console.log('\n--- Section B: Problem Retrieval & Hidden Test Isolation ---');
    // GET /problems
    const listRes = await request('GET', '/problems');
    assert(listRes.status === 200, 'GET /problems returns 200');
    assert(listRes.data.data.problems.length === 1, 'Problem list contains created problem');
    assert(listRes.data.data.problems[0].testCases === undefined, 'Problem list omits test cases');

    // GET /problems/:slug
    const detailRes = await request('GET', '/problems/fibonacci-number');
    assert(detailRes.status === 200, 'GET /problems/:slug returns 200');
    const retrieved = detailRes.data.data.problem;
    assert(retrieved.sampleTestCases.length === 2, 'GET /problems/:slug returns only sample cases (count=2)');
    const hasHidden = retrieved.sampleTestCases.some((tc) => tc.input === '10');
    assert(!hasHidden, 'CRITICAL SECURITY: Hidden test cases are strictly excluded from GET /problems/:slug');

    console.log('\n--- Section C: Test Cases CRUD ---');
    // Admin adds an extra hidden testcase
    const addTcRes = await request(
      'POST',
      `/problems/${createdProblemId}/testcases`,
      { input: '15', expectedOutput: '610', isHidden: true },
      adminToken
    );
    assert(addTcRes.status === 201, 'Admin can add test case via POST /problems/:id/testcases');

    // Admin inspects all test cases (both sample and hidden)
    const adminTcRes = await request('GET', `/problems/${createdProblemId}/testcases`, null, adminToken);
    assert(adminTcRes.status === 200, 'Admin can view all test cases');
    assert(adminTcRes.data.data.testCases.length === 4, 'Admin receives all 4 test cases (sample + hidden)');

    // Student cannot access admin testcases endpoint
    const studentTcRes = await request('GET', `/problems/${createdProblemId}/testcases`, null, studentToken);
    assert(studentTcRes.status === 403, 'Student is blocked from GET /problems/:id/testcases (403)');

    console.log('\n--- Section D: Problem Update & Cascade Delete ---');
    // Admin updates problem
    const updateRes = await request(
      'PUT',
      `/problems/${createdProblemId}`,
      { difficulty: 'medium', timeLimitMs: 1500 },
      adminToken
    );
    assert(updateRes.status === 200, 'Admin can update problem via PUT /problems/:id');
    assert(updateRes.data.data.problem.difficulty === 'medium', 'Problem difficulty updated');

    // Admin deletes problem
    const deleteRes = await request('DELETE', `/problems/${createdProblemId}`, null, adminToken);
    assert(deleteRes.status === 200, 'Admin can delete problem via DELETE /problems/:id');

    // Verify cascade deletion of test cases
    const remainingTestCases = await TestCase.countDocuments({ problemId: createdProblemId });
    assert(remainingTestCases === 0, 'Cascade delete removed all associated test cases');

    console.log('\n--- Section E: JSON Problem Seeder Verification ---');
    const rawData = fs.readFileSync(path.join(__dirname, '../src/seeds/problems.json'), 'utf-8');
    const seedData = JSON.parse(rawData);
    assert(seedData.length >= 8, `Seeder JSON contains ${seedData.length} problems (>= 8 required)`);

    // Verify all seeded problems have proper test cases
    let allHaveSamples = true;
    let allHaveHidden = true;
    for (const prob of seedData) {
      const samples = prob.testCases.filter((tc) => !tc.isHidden);
      const hidden = prob.testCases.filter((tc) => tc.isHidden);
      if (samples.length === 0) allHaveSamples = false;
      if (hidden.length === 0) allHaveHidden = false;
    }
    assert(allHaveSamples, 'All seeded problems have at least one sample test case');
    assert(allHaveHidden, 'All seeded problems have at least one hidden test case');

    console.log('\n====================================================');
    console.log(`  Phase 2 Results: ${passed} passed, ${failed} failed`);
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

runPhase2Tests();
