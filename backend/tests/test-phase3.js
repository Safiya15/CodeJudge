process.env.MOCK_JUDGE0 = 'true'; // Enable mock mode for deterministic offline testing

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { User, Problem, TestCase } = require('../src/models');
const { normalizeOutput, compareOutputs } = require('../src/utils/comparator');
const { mapJudge0Status } = require('../src/services/judge0.service');
const http = require('http');

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

const runPhase3Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 3 Automated Test Suite');
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
    console.log('--- Section A: Output Normalizer & Comparator ---');
    assert(
      compareOutputs('Hello World\r\n', 'Hello World\n'),
      'Normalizes CRLF to standard LF'
    );
    assert(
      compareOutputs('42  \n\n', '42\n'),
      'Trims trailing spaces and trailing empty lines'
    );
    assert(
      compareOutputs('1 2 3\n4 5 6  ', '1 2 3\n4 5 6'),
      'Handles multi-line standard competitive programming output'
    );
    assert(
      !compareOutputs('42', '43'),
      'Correctly rejects mismatched outputs'
    );

    console.log('\n--- Section B: Judge0 Verdict Status Mapping ---');
    assert(mapJudge0Status(3) === 'Accepted', 'Status 3 maps to Accepted');
    assert(mapJudge0Status(4) === 'Wrong Answer', 'Status 4 maps to Wrong Answer');
    assert(mapJudge0Status(5) === 'Time Limit Exceeded', 'Status 5 maps to Time Limit Exceeded');
    assert(mapJudge0Status(6) === 'Compilation Error', 'Status 6 maps to Compilation Error');
    assert(mapJudge0Status(11) === 'Runtime Error', 'Status 11 maps to Runtime Error (NZEC)');
    assert(
      mapJudge0Status(12, 'Memory Limit Exceeded', '') === 'Memory Limit Exceeded',
      'Detects Memory Limit Exceeded from description'
    );

    console.log('\n--- Section C: Database & Auth Setup ---');
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;

    const studentRes = await request('POST', '/auth/register', {
      name: 'Coder Charlie',
      email: 'charlie@codejudge.com',
      password: 'password123',
    });
    const studentToken = studentRes.data.data.token;
    const studentId = studentRes.data.data.user._id;

    // Create problem with 2 sample cases and 2 hidden cases
    const problem = await Problem.create({
      title: 'Two Sum Test',
      slug: 'two-sum-test',
      statement: 'Add two numbers.',
      difficulty: 'easy',
      allowedLanguages: ['cpp', 'python', 'javascript'],
      timeLimitMs: 1000,
      memoryLimitMb: 128,
      createdBy: studentId,
    });

    await TestCase.create([
      { problemId: problem._id, input: '2 7 9', expectedOutput: '0 1', isHidden: false, order: 1 },
      { problemId: problem._id, input: '3 2 6', expectedOutput: '1 2', isHidden: false, order: 2 },
      { problemId: problem._id, input: '3 3 6', expectedOutput: '0 1', isHidden: true, order: 3 },
      { problemId: problem._id, input: '5 8 13', expectedOutput: '1 2', isHidden: true, order: 4 },
    ]);

    console.log('\n--- Section D: POST /run Validation & Security ---');
    // 1. Unauthenticated request
    const unauthRun = await request('POST', '/run', {
      problemId: problem._id,
      language: 'cpp',
      code: 'int main() {}',
    });
    assert(unauthRun.status === 401, 'POST /run rejects unauthenticated calls (401)');

    // 2. Disallowed language
    const invalidLangRun = await request(
      'POST',
      '/run',
      { problemId: problem._id, language: 'rust', code: 'fn main() {}' },
      studentToken
    );
    assert(invalidLangRun.status === 400, 'POST /run rejects disallowed language (400)');

    // 3. Oversized code check
    const hugeCode = 'x = 1;\n'.repeat(12000); // ~96 KB > 64 KB
    const hugeCodeRun = await request(
      'POST',
      '/run',
      { problemId: problem._id, language: 'python', code: hugeCode },
      studentToken
    );
    assert(hugeCodeRun.status === 400, 'POST /run rejects payload exceeding 64KB');

    console.log('\n--- Section E: POST /run Execution & Sample Case Isolation ---');
    // 4. Successful run on sample cases
    const runRes = await request(
      'POST',
      '/run',
      {
        problemId: problem._id,
        language: 'python',
        code: 'print("0 1")',
      },
      studentToken
    );
    assert(runRes.status === 200, 'POST /run returns 200 OK');
    assert(Array.isArray(runRes.data.data.results), 'Returns results array');
    assert(runRes.data.data.results.length === 2, 'Runs ONLY the 2 sample cases (count = 2)');

    // CRITICAL SECURITY ASSERTION
    const executedHidden = runRes.data.data.results.some(
      (r) => r.input === '3 3 6' || r.input === '5 8 13'
    );
    assert(!executedHidden, 'CRITICAL SECURITY: POST /run strictly ignores hidden test cases');

    // 5. Run with compilation error (should short-circuit)
    const compileErrRun = await request(
      'POST',
      '/run',
      {
        problemId: problem._id,
        language: 'cpp',
        code: 'int main() { syntax_error }',
      },
      studentToken
    );
    assert(compileErrRun.status === 200, 'POST /run handles compilation error gracefully');
    assert(compileErrRun.data.data.passed === false, 'Marked passed as false');
    assert(
      compileErrRun.data.data.results[0].status === 'Compilation Error',
      'Reports Compilation Error status'
    );
    assert(
      compileErrRun.data.data.results.length === 1,
      'Short-circuited remaining test cases upon compilation failure'
    );

    console.log('\n====================================================');
    console.log(`  Phase 3 Results: ${passed} passed, ${failed} failed`);
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

runPhase3Tests();
