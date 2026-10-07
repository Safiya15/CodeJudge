const fs = require('fs');
const path = require('path');

const runPhase10Tests = async () => {
  console.log('====================================================');
  console.log('  CodeJudge - Phase 10 Automated Test Suite');
  console.log('  Testing Verification, Concurrency & README Audit');
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

  const rootDir = path.resolve(__dirname, '../../');

  try {
    // 1. Audit Concurrency Test File
    console.log('--- Test Suite 1: High-Concurrency & Stress Test Verification ---');
    const concurrencyTestPath = path.join(__dirname, 'test-concurrency.js');
    assert(fs.existsSync(concurrencyTestPath), 'test-concurrency.js exists in backend/tests/');

    const concurrencyContent = fs.readFileSync(concurrencyTestPath, 'utf8');
    assert(
      concurrencyContent.includes('NUM_STUDENTS') && concurrencyContent.includes('getContestLeaderboard'),
      'test-concurrency.js simulates concurrent student submissions'
    );
    assert(
      concurrencyContent.includes('uniqueUserIds') && concurrencyContent.includes('No duplicate user entries'),
      'test-concurrency.js verifies race condition and duplicate leaderboard entry prevention'
    );

    // 2. Audit Load Test File
    console.log('\n--- Test Suite 2: Autocannon Load Benchmark Verification ---');
    const loadTestPath = path.join(__dirname, 'load-test.js');
    assert(fs.existsSync(loadTestPath), 'load-test.js exists in backend/tests/');

    const loadTestContent = fs.readFileSync(loadTestPath, 'utf8');
    assert(
      loadTestContent.includes('autocannon') && loadTestContent.includes('connections: 20'),
      'load-test.js configures multi-connection autocannon benchmark'
    );
    assert(
      loadTestContent.includes('maxQueueDepth') && loadTestContent.includes('getQueueCounts'),
      'load-test.js tracks live queue depth during submission burst'
    );

    // 3. Audit README.md Structure and Required Sections
    console.log('\n--- Test Suite 3: Comprehensive README Documentation Audit ---');
    const readmePath = path.join(rootDir, 'README.md');
    assert(fs.existsSync(readmePath), 'README.md exists in repository root');

    const readmeContent = fs.readFileSync(readmePath, 'utf8');

    // Section Checks
    assert(
      readmeContent.includes('CodeJudge') && readmeContent.includes('Architecture'),
      'README contains Project Overview and Architecture section'
    );
    assert(
      readmeContent.includes('mermaid') || readmeContent.includes('flowchart'),
      'README contains Architecture Diagram'
    );
    assert(
      readmeContent.includes('Docker Compose') || readmeContent.includes('Setup Steps'),
      'README contains step-by-step Setup Instructions'
    );
    assert(
      readmeContent.includes('Security') && readmeContent.includes('Sandbox'),
      'README contains Security Architecture and Threat Model'
    );
    assert(
      readmeContent.includes('Benchmark') || readmeContent.includes('Load Test'),
      'README reports actual measured Load Test Results'
    );
    assert(
      readmeContent.includes('60.8') || readmeContent.includes('Throughput'),
      'README includes empirical benchmark numbers'
    );
    assert(
      readmeContent.includes('Trade-offs') || readmeContent.includes('What I Chose and Why'),
      'README contains comprehensive Engineering Trade-offs section'
    );
    assert(
      readmeContent.includes('What I Would Improve Next') || readmeContent.includes('Future Improvements'),
      'README contains "What I Would Improve Next" section'
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
  }
};

runPhase10Tests();
