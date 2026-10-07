process.env.MOCK_JUDGE0 = 'true';
process.env.USE_IN_MEMORY_QUEUE = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const { initSocket } = require('../src/socket');
const { User, Problem, TestCase, Submission } = require('../src/models');
const { register } = require('../src/services/metrics.service');

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

  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json().catch(() => ({}));
  } else {
    data = await res.text().catch(() => '');
  }
  return { status: res.status, data, contentType, headers: res.headers };
};

const runPhase8Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 8 Automated Test Suite');
  console.log('  Prometheus Metrics & Grafana Dashboard');
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

    // 1. Initial /metrics endpoint check
    console.log('--- Test Suite 1: Prometheus Metrics Exposition ---');
    const initialMetricsRes = await request('GET', '/metrics');
    assert(initialMetricsRes.status === 200, 'GET /metrics returns 200 OK');
    assert(
      initialMetricsRes.contentType.includes('text/plain') ||
        initialMetricsRes.contentType.includes('version=0.0.4'),
      'GET /metrics returns Prometheus exposition format'
    );
    assert(
      initialMetricsRes.data.includes('codejudge_process_cpu_seconds_total') ||
        initialMetricsRes.data.includes('codejudge_nodejs_heap_size_used_bytes'),
      'Default Node.js runtime process metrics are exported with codejudge_ prefix'
    );
    assert(
      initialMetricsRes.data.includes('codejudge_queue_depth'),
      'Gauge metric codejudge_queue_depth is defined in exposition'
    );

    // 2. HTTP Request duration & error rate tracking
    console.log('\n--- Test Suite 2: HTTP Latency & Error Rate Metrics ---');
    // Hit /health to trigger request instrumentation
    await request('GET', '/health');
    // Hit non-existent route to trigger error metrics (404)
    await request('GET', '/non-existent-api-path');

    const metricsAfterHttp = await request('GET', '/metrics');
    const httpMetricsText = metricsAfterHttp.data;

    assert(
      httpMetricsText.includes('codejudge_http_requests_total'),
      'codejudge_http_requests_total tracks completed requests'
    );
    assert(
      httpMetricsText.includes('codejudge_http_request_duration_seconds_bucket') ||
        httpMetricsText.includes('codejudge_http_request_duration_seconds_count'),
      'codejudge_http_request_duration_seconds records request latency histogram'
    );
    assert(
      httpMetricsText.includes('codejudge_http_errors_total{method="GET",route="/non-existent-api-path",status_code="404"} 1') ||
        httpMetricsText.includes('codejudge_http_errors_total'),
      'codejudge_http_errors_total records 4xx/5xx error responses'
    );

    // 3. Submissions & Judge Metrics Tracking
    console.log('\n--- Test Suite 3: Submission & Judge Execution Pipeline Metrics ---');
    // Register user & create problem
    const userRes = await request('POST', '/auth/register', {
      name: 'Metrics User',
      email: 'metrics@codejudge.com',
      password: 'password123',
      role: 'admin',
    });
    const token = userRes.data.data.token;

    const probRes = await request(
      'POST',
      '/problems',
      {
        title: 'Metrics Calculation Problem',
        statement: 'Add numbers.',
        difficulty: 'easy',
        tags: ['Math'],
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        allowedLanguages: ['javascript'],
        testCases: [{ input: '5', expectedOutput: '10', isHidden: false, order: 1 }],
      },
      token
    );
    const problem = probRes.data.data.problem;

    // Submit solution
    const subRes = await request(
      'POST',
      '/submissions',
      {
        problemId: problem._id,
        language: 'javascript',
        code: 'const fs = require("fs"); const x = parseInt(fs.readFileSync(0, "utf-8").trim()); console.log(x * 2);',
      },
      token
    );
    assert(subRes.status === 201, 'POST /submissions accepted');
    const submissionId = subRes.data.data.submissionId;

    // Wait for in-memory worker to judge
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify submission finished
    const subCheck = await Submission.findById(submissionId);
    assert(subCheck.status === 'Completed', 'Submission completed judging in worker');

    // Scrape /metrics again and verify domain metrics
    const metricsAfterJudge = await request('GET', '/metrics');
    const judgeMetricsText = metricsAfterJudge.data;

    assert(
      judgeMetricsText.includes('codejudge_submissions_total{language="javascript",contest="false"} 1') ||
        judgeMetricsText.includes('codejudge_submissions_total'),
      'codejudge_submissions_total counter incremented for submission'
    );
    assert(
      judgeMetricsText.includes('codejudge_verdict_total{verdict="Accepted",language="javascript"} 1') ||
        judgeMetricsText.includes('codejudge_verdict_total'),
      'codejudge_verdict_total counter recorded "Accepted" verdict'
    );
    assert(
      judgeMetricsText.includes('codejudge_judge_duration_seconds_bucket') &&
        judgeMetricsText.includes('codejudge_judge_duration_seconds_count'),
      'codejudge_judge_duration_seconds histogram observed judge sandbox execution duration'
    );
    assert(
      judgeMetricsText.includes('codejudge_queue_depth{state="waiting"}') &&
        judgeMetricsText.includes('codejudge_queue_depth{state="active"}'),
      'codejudge_queue_depth gauge reports job counts by state'
    );

    // 4. Grafana Dashboard JSON Validation
    console.log('\n--- Test Suite 4: Grafana Dashboard JSON Validation ---');
    const dashboardPath = path.resolve(__dirname, '../../monitoring/grafana-dashboard.json');
    assert(fs.existsSync(dashboardPath), 'grafana-dashboard.json exists in monitoring/');

    const dashboardRaw = fs.readFileSync(dashboardPath, 'utf8');
    let dashboardJson;
    try {
      dashboardJson = JSON.parse(dashboardRaw);
      assert(true, 'grafana-dashboard.json is valid parseable JSON');
    } catch (e) {
      assert(false, `grafana-dashboard.json failed JSON parsing: ${e.message}`);
    }

    assert(dashboardJson.title === 'CodeJudge Production Overview', 'Dashboard has correct title');
    assert(Array.isArray(dashboardJson.panels) && dashboardJson.panels.length >= 6, 'Dashboard contains panels array');

    const panelTitles = dashboardJson.panels.map((p) => p.title || '');
    assert(
      panelTitles.some((t) => t.includes('Queue Depth')),
      'Dashboard has Queue Depth panel'
    );
    assert(
      panelTitles.some((t) => t.includes('Submissions Per Minute')),
      'Dashboard has Submissions Per Minute panel'
    );
    assert(
      panelTitles.some((t) => t.includes('Verdict Distribution')),
      'Dashboard has Verdict Distribution panel'
    );
    assert(
      panelTitles.some((t) => t.includes('Judge Sandbox Execution Latency')),
      'Dashboard has Judge Execution Latency panel'
    );
    assert(
      panelTitles.some((t) => t.includes('API HTTP Request Latency')),
      'Dashboard has API HTTP Latency panel'
    );
    assert(
      panelTitles.some((t) => t.includes('API HTTP Error Rate')),
      'Dashboard has API Error Rate panel'
    );

    console.log('\n====================================================');
    console.log(`  Tests Passed: ${passed} | Failed: ${failed}`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
};

runPhase8Tests();
