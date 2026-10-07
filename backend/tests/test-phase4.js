process.env.MOCK_JUDGE0 = 'true';
process.env.USE_IN_MEMORY_QUEUE = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { User, Problem, TestCase, Submission } = require('../src/models');
const { judgeProcessor } = require('../src/workers/judgeProcessor');
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

const runPhase4Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 4 Automated Test Suite');
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

    console.log('--- Setup: Users and Problem ---');
    const student1Res = await request('POST', '/auth/register', {
      name: 'Alice Coder',
      email: 'alice.sub@codejudge.com',
      password: 'password123',
    });
    const student1Token = student1Res.data.data.token;
    const student1Id = student1Res.data.data.user._id;

    const student2Res = await request('POST', '/auth/register', {
      name: 'Bob Coder',
      email: 'bob.sub@codejudge.com',
      password: 'password123',
    });
    const student2Token = student2Res.data.data.token;

    const problem = await Problem.create({
      title: 'Two Sum Pipeline',
      slug: 'two-sum-pipeline',
      statement: 'Find two indices.',
      difficulty: 'easy',
      allowedLanguages: ['cpp', 'python', 'javascript'],
      timeLimitMs: 1500,
      memoryLimitMb: 128,
      createdBy: student1Id,
    });

    // 2 sample cases, 2 hidden cases
    await TestCase.create([
      { problemId: problem._id, input: '2 7 9', expectedOutput: '0 1', isHidden: false, order: 1 },
      { problemId: problem._id, input: '3 2 6', expectedOutput: '1 2', isHidden: false, order: 2 },
      { problemId: problem._id, input: '3 3 6', expectedOutput: '0 1', isHidden: true, order: 3 },
      { problemId: problem._id, input: '5 8 13', expectedOutput: '1 2', isHidden: true, order: 4 },
    ]);

    console.log('\n--- Section A: POST /submissions API ---');
    // 1. Unauthenticated request rejected
    const unauthSub = await request('POST', '/submissions', {
      problemId: problem._id,
      language: 'cpp',
      code: 'int main() {}',
    });
    assert(unauthSub.status === 401, 'POST /submissions rejects unauthenticated requests (401)');

    // 2. Disallowed language
    const invalidLangSub = await request(
      'POST',
      '/submissions',
      { problemId: problem._id, language: 'ruby', code: 'puts "hi"' },
      student1Token
    );
    assert(invalidLangSub.status === 400, 'POST /submissions rejects disallowed language (400)');

    // 3. Valid submission enqueues and returns immediately with 201 Created and Pending status
    const validSubRes = await request(
      'POST',
      '/submissions',
      {
        problemId: problem._id,
        language: 'python',
        code: 'print("0 1")',
      },
      student1Token
    );
    assert(validSubRes.status === 201, 'POST /submissions creates submission (201)');
    assert(validSubRes.data.data.status === 'Pending', 'Initial status is Pending');
    const submission1Id = validSubRes.data.data.submissionId;
    assert(submission1Id != null, 'Returns submissionId immediately');

    console.log('\n--- Section B: Judge Worker Execution Pipeline ---');
    // 4. Test worker evaluating an Accepted submission (all 4 cases pass)
    const acceptedSubmission = await Submission.create({
      userId: student1Id,
      problemId: problem._id,
      language: 'python',
      code: 'print("accepted")',
      status: 'Pending',
    });

    const jobResult = await judgeProcessor({
      data: { submissionId: acceptedSubmission._id },
      id: 'job-1',
    });
    assert(jobResult.verdict === 'Accepted', 'Judge worker assigns Accepted verdict on clean pass');
    assert(jobResult.runtimeMs >= 0, 'Judge worker records runtime in milliseconds');
    assert(jobResult.memoryKb >= 0, 'Judge worker records memory in KB');

    const updatedSub = await Submission.findById(acceptedSubmission._id);
    assert(updatedSub.status === 'Completed', 'Submission status updated to Completed in MongoDB');
    assert(updatedSub.verdict === 'Accepted', 'Verdict persisted in database');

    console.log('\n--- Section C: Hidden Test Case Failure & Short-Circuiting ---');
    // 5. Test worker evaluating code that passes samples but fails hidden test #3
    const waSubmission = await Submission.create({
      userId: student1Id,
      problemId: problem._id,
      language: 'python',
      code: 'FORCE_WRONG_ANSWER',
      status: 'Pending',
    });

    const waJobResult = await judgeProcessor({
      data: { submissionId: waSubmission._id },
      id: 'job-2',
    });
    assert(waJobResult.verdict === 'Wrong Answer', 'Worker detects test case failure');
    assert(waJobResult.failedTestIndex === 1, 'Worker flags the first failing test index');

    const updatedWaSub = await Submission.findById(waSubmission._id);
    assert(updatedWaSub.verdict === 'Wrong Answer', 'Wrong Answer verdict persisted');
    assert(updatedWaSub.failedTestIndex === 1, 'failedTestIndex persisted in database');

    console.log('\n--- Section D: Worker Idempotency Guard ---');
    // 6. Retrying an already completed job should not re-run or mutate data
    const idempotentResult = await judgeProcessor({
      data: { submissionId: acceptedSubmission._id },
      id: 'job-retry-1',
    });
    assert(idempotentResult.alreadyCompleted === true, 'Worker detects already Completed submission (Idempotent)');
    assert(idempotentResult.verdict === 'Accepted', 'Preserves original verdict without mutation');

    console.log('\n--- Section E: Submission Queries & Code Privacy ---');
    // 7. GET /submissions/:id by owner includes code
    const ownerGetRes = await request('GET', `/submissions/${acceptedSubmission._id}`, null, student1Token);
    assert(ownerGetRes.status === 200, 'Owner can retrieve submission details');
    assert(ownerGetRes.data.data.submission.code != null, 'Owner can view own submitted code');

    // 8. GET /submissions/:id by another student HIDES the code
    const otherGetRes = await request('GET', `/submissions/${acceptedSubmission._id}`, null, student2Token);
    assert(otherGetRes.status === 200, 'Another student can retrieve submission verdict');
    assert(
      otherGetRes.data.data.submission.code === undefined,
      'CRITICAL SECURITY: Other student is prohibited from viewing competitor code'
    );

    // 9. GET /submissions list with mine=true filter
    const listMineRes = await request('GET', '/submissions?mine=true', null, student1Token);
    assert(listMineRes.status === 200, 'GET /submissions?mine=true returns 200');
    assert(listMineRes.data.data.submissions.length >= 2, 'Lists user submissions');
    assert(
      listMineRes.data.data.submissions.every((s) => s.code === undefined),
      'List endpoint strips code field for performance and security'
    );

    console.log('\n====================================================');
    console.log(`  Phase 4 Results: ${passed} passed, ${failed} failed`);
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

runPhase4Tests();
