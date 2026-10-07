const { compareOutputs } = require('../utils/comparator');

const JUDGE0_URL = process.env.JUDGE0_URL || 'http://localhost:2358';
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || null;

// Standard Judge0 CE language IDs
const LANGUAGE_MAP = {
  cpp: Number(process.env.JUDGE0_LANG_CPP || 54),        // C++ (GCC 9.2.0)
  python: Number(process.env.JUDGE0_LANG_PYTHON || 71),  // Python (3.8.1)
  java: Number(process.env.JUDGE0_LANG_JAVA || 62),      // Java (OpenJDK 13.0.1)
  javascript: Number(process.env.JUDGE0_LANG_JS || 63),  // JavaScript (Node.js 12.14.0)
};

/**
 * Maps Judge0 status id to CodeJudge verdict
 */
const mapJudge0Status = (statusId, statusDescription, stderr) => {
  if (statusId === 3) return 'Accepted';
  if (statusId === 4) return 'Wrong Answer';
  if (statusId === 5) return 'Time Limit Exceeded';
  if (statusId === 6) return 'Compilation Error';

  // Check for Memory Limit Exceeded
  if (
    (statusDescription && statusDescription.toLowerCase().includes('memory')) ||
    (stderr && stderr.toLowerCase().includes('memory limit'))
  ) {
    return 'Memory Limit Exceeded';
  }

  // Judge0 status 7-12 are runtime errors
  if (statusId >= 7 && statusId <= 12) return 'Runtime Error';

  return 'Runtime Error';
};

/**
 * Executes a single code submission against Judge0 sandbox synchronously.
 */
const runSingleCase = async ({
  code,
  language,
  stdin,
  expectedOutput,
  timeLimitMs = 2000,
  memoryLimitMb = 256,
}) => {
  const languageId = LANGUAGE_MAP[language.toLowerCase()];
  if (!languageId) {
    throw new Error(`Unsupported programming language: ${language}`);
  }

  // If mock mode is explicitly enabled (e.g. unit tests or local dev without Docker)
  if (process.env.MOCK_JUDGE0 === 'true') {
    return mockExecute({ code, language, stdin, expectedOutput });
  }

  const payload = {
    source_code: code,
    language_id: languageId,
    stdin: stdin || '',
    expected_output: expectedOutput || undefined,
    cpu_time_limit: timeLimitMs / 1000, // Judge0 takes seconds
    memory_limit: memoryLimitMb * 1024, // Judge0 takes KB
  };

  const headers = {
    'Content-Type': 'application/json',
  };
  if (JUDGE0_API_KEY) {
    headers['X-RapidAPI-Key'] = JUDGE0_API_KEY;
    headers['X-RapidAPI-Host'] = 'judge0-ce.p.rapidapi.com';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeLimitMs + 8000);

  try {
    const response = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=false&wait=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Judge0] Sandbox error response (${response.status}): ${errText}`);
      throw new Error('Judge sandbox temporary execution failure.');
    }

    const data = await response.json();
    const actualOutput = data.stdout || '';
    const compileError = data.compile_output || null;
    const stderr = data.stderr || null;
    const runtimeMs = data.time != null ? Math.round(parseFloat(data.time) * 1000) : null;
    const memoryKb = data.memory != null ? data.memory : null;

    let verdict = mapJudge0Status(data.status?.id, data.status?.description, stderr);

    // If Judge0 marked it as Accepted or returned stdout, verify via strict comparison utility
    if (verdict === 'Accepted' && expectedOutput !== undefined) {
      const isMatch = compareOutputs(actualOutput, expectedOutput);
      if (!isMatch) {
        verdict = 'Wrong Answer';
      }
    }

    return {
      status: verdict,
      stdout: actualOutput,
      stderr,
      compileError,
      runtimeMs,
      memoryKb,
      exitCode: data.exit_code,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return {
        status: 'Time Limit Exceeded',
        stdout: '',
        stderr: 'Time Limit Exceeded (Timeout)',
        compileError: null,
        runtimeMs: timeLimitMs,
        memoryKb: null,
      };
    }
    throw err;
  }
};

/**
 * Lightweight mock executor for offline development/testing when Judge0 Docker is not active
 */
const mockExecute = async ({ code, language, stdin, expectedOutput }) => {
  // Check for intentional syntax error
  if (code.includes('syntax_error') || code.includes('COMPILE_ERROR')) {
    return {
      status: 'Compilation Error',
      stdout: '',
      stderr: 'SyntaxError: Unexpected token',
      compileError: 'error: expected ";" before "}"',
      runtimeMs: 10,
      memoryKb: 2048,
    };
  }

  // Check for intentional infinite loop
  if (code.includes('while(true)') || code.includes('while (true)') || code.includes('while True:')) {
    return {
      status: 'Time Limit Exceeded',
      stdout: '',
      stderr: 'Time Limit Exceeded',
      compileError: null,
      runtimeMs: 2000,
      memoryKb: 10240,
    };
  }

  // Simple echo or output matcher
  let stdout = expectedOutput || '';
  if (code.includes('FORCE_WRONG_ANSWER')) {
    stdout = 'wrong_result_123';
  }

  const isMatch = compareOutputs(stdout, expectedOutput);
  return {
    status: isMatch ? 'Accepted' : 'Wrong Answer',
    stdout,
    stderr: null,
    compileError: null,
    runtimeMs: 15,
    memoryKb: 4096,
  };
};

module.exports = {
  LANGUAGE_MAP,
  runSingleCase,
  mapJudge0Status,
};
