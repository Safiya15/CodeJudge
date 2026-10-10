
const { compareOutputs } = require('../utils/comparator');

const JUDGE0_URL = (
  process.env.JUDGE0_URL || 'https://ce.judge0.com'
).replace(/\/+$/, '');

const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || null;

// Standard Judge0 CE language IDs
const LANGUAGE_MAP = {
  cpp: Number(process.env.JUDGE0_LANG_CPP || 54),
  python: Number(process.env.JUDGE0_LANG_PYTHON || 71),
  java: Number(process.env.JUDGE0_LANG_JAVA || 62),
  javascript: Number(process.env.JUDGE0_LANG_JS || 63),
};

const mapJudge0Status = (statusId, statusDescription, stderr) => {
  if (statusId === 3) return 'Accepted';
  if (statusId === 4) return 'Wrong Answer';
  if (statusId === 5) return 'Time Limit Exceeded';
  if (statusId === 6) return 'Compilation Error';

  if (
    (statusDescription &&
      statusDescription.toLowerCase().includes('memory')) ||
    (stderr && stderr.toLowerCase().includes('memory limit'))
  ) {
    return 'Memory Limit Exceeded';
  }

  if (statusId >= 7 && statusId <= 12) return 'Runtime Error';

  return 'Runtime Error';
};

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

  if (process.env.MOCK_JUDGE0 === 'true') {
    return mockExecute({ code, language, stdin, expectedOutput });
  }

  const payload = {
    source_code: code,
    language_id: languageId,
    stdin: stdin || '',
    cpu_time_limit: timeLimitMs / 1000,
    memory_limit: memoryLimitMb * 1024,
  };

  if (expectedOutput !== undefined) {
    payload.expected_output = expectedOutput;
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  // Add RapidAPI headers only when using the RapidAPI endpoint.
  if (JUDGE0_API_KEY && JUDGE0_URL.includes('rapidapi.com')) {
    headers['X-RapidAPI-Key'] = JUDGE0_API_KEY;
    headers['X-RapidAPI-Host'] = 'judge0-ce.p.rapidapi.com';
  }

  const controller = new AbortController();

  // Allow extra time for queueing and compilation beyond the code time limit.
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(timeLimitMs + 30000, 45000)
  );

  try {
    // 1. Submit the code asynchronously and receive a token.
    const submitResponse = await fetch(
      `${JUDGE0_URL}/submissions?base64_encoded=false&wait=false`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      console.error(
        `[Judge0] Submission failed (${submitResponse.status}): ${errorText}`
      );
      throw new Error(`Judge0 submission failed: HTTP ${submitResponse.status}`);
    }

    const submission = await submitResponse.json();

    if (!submission.token) {
      throw new Error('Judge0 did not return a submission token.');
    }

    // 2. Poll until Judge0 finishes processing the submission.
    let data;

    while (true) {
      await sleep(1000);

      const resultResponse = await fetch(
        `${JUDGE0_URL}/submissions/${encodeURIComponent(
          submission.token
        )}?base64_encoded=false`,
        {
          method: 'GET',
          headers,
          signal: controller.signal,
        }
      );

      if (!resultResponse.ok) {
        const errorText = await resultResponse.text();
        console.error(
          `[Judge0] Result request failed (${resultResponse.status}): ${errorText}`
        );
        throw new Error(
          `Judge0 result request failed: HTTP ${resultResponse.status}`
        );
      }

      data = await resultResponse.json();

      const statusId = data.status?.id;

      // Status 1 = In Queue, 2 = Processing.
      if (statusId !== 1 && statusId !== 2) {
        break;
      }
    }

    const actualOutput = data.stdout || '';
    const compileError = data.compile_output || null;
    const stderr = data.stderr || null;
    const runtimeMs =
      data.time != null ? Math.round(Number(data.time) * 1000) : null;
    const memoryKb = data.memory != null ? data.memory : null;

    let verdict = mapJudge0Status(
      data.status?.id,
      data.status?.description,
      stderr
    );

    if (verdict === 'Accepted' && expectedOutput !== undefined) {
      if (!compareOutputs(actualOutput, expectedOutput)) {
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
    if (err.name === 'AbortError') {
      return {
        status: 'Time Limit Exceeded',
        stdout: '',
        stderr: 'Judge0 request timed out.',
        compileError: null,
        runtimeMs: timeLimitMs,
        memoryKb: null,
      };
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

const mockExecute = async ({ code, language, stdin, expectedOutput }) => {
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

  if (
    code.includes('while(true)') ||
    code.includes('while (true)') ||
    code.includes('while True:')
  ) {
    return {
      status: 'Time Limit Exceeded',
      stdout: '',
      stderr: 'Time Limit Exceeded',
      compileError: null,
      runtimeMs: 2000,
      memoryKb: 10240,
    };
  }

  const stdout = code.includes('FORCE_WRONG_ANSWER')
    ? 'wrong_result_123'
    : expectedOutput || '';

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
