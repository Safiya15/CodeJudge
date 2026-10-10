const OpenAI = require('openai');

const MODE_INSTRUCTIONS = {
  hint: `
Give the student a progressive hint for solving the problem.

Rules:
- Do NOT provide the complete solution.
- Do NOT provide a full working code implementation.
- Start with a conceptual hint.
- Help the student discover the next step themselves.
- If the student asks again, the hint can become more specific.
- Keep the response concise and educational.
`,

  explain_error: `
Explain the student's error.

Identify whether the issue is likely:
- compilation/syntax,
- runtime,
- logical/correctness,
- input/output handling, or
- algorithmic.

Explain the likely cause and how the student can debug or fix it.
Do NOT provide a complete replacement solution unless a tiny code fragment is necessary to explain the issue.
`,

  review_code: `
Review the student's code as a programming mentor.

Discuss:
1. Correctness
2. Logical issues
3. Readability
4. Code structure
5. Edge cases
6. Potential improvements

Do NOT rewrite the entire solution.
Do NOT simply give the final answer.
Give actionable feedback that helps the student improve their own code.
`,

  complexity: `
Analyze the student's algorithm.

Explain:
- estimated time complexity,
- estimated space complexity,
- which operations dominate the complexity,
- whether the approach is appropriate for the problem.

If there is a significantly better complexity, explain the idea without giving a complete solution.
`,
};

const MAX_CODE_LENGTH = 30000;
const MAX_ERROR_LENGTH = 10000;
const MAX_STATEMENT_LENGTH = 20000;

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};

const buildMentorPrompt = ({
  mode,
  problem,
  code,
  language,
  errorMessage,
}) => {
  const safeStatement = String(problem.statement || '').slice(
    0,
    MAX_STATEMENT_LENGTH
  );

  const safeCode = String(code || '').slice(0, MAX_CODE_LENGTH);

  const safeError = String(errorMessage || '').slice(0, MAX_ERROR_LENGTH);

  return `
You are CodeJudge AI Mentor, an educational programming assistant.

You are helping a student solve a practice programming problem.

IMPORTANT RULES:
- Help the student learn rather than simply giving the answer.
- Do not reveal hidden test cases.
- Do not invent hidden test cases.
- Do not provide a complete solution for the "hint" mode.
- Do not expose internal CodeJudge implementation details.
- Use the student's selected programming language.
- Base your answer primarily on the supplied problem statement and student code.
- Be concise but useful.
- Use Markdown when it improves readability.

TASK:
${MODE_INSTRUCTIONS[mode]}

PROBLEM:
Title: ${problem.title}
Difficulty: ${problem.difficulty}
Tags: ${(problem.tags || []).join(', ') || 'None'}

Problem Statement:
${safeStatement}

PROGRAMMING LANGUAGE:
${language || 'Not specified'}

STUDENT CODE:
${safeCode || '(No code provided)'}

ERROR / COMPILER OUTPUT:
${safeError || '(No error provided)'}

Now respond as a helpful programming mentor.
`;
};

const mentor = async ({
  mode,
  problem,
  code = '',
  language = '',
  errorMessage = '',
}) => {
  if (!MODE_INSTRUCTIONS[mode]) {
    throw new Error('Unsupported AI Mentor mode.');
  }

  const client = getOpenAIClient();

  const response = await client.responses.create({
    model: process.env.AI_MENTOR_MODEL || 'gpt-6-luna',
    instructions:
      'You are a careful coding mentor. Never reveal hidden tests or confidential platform information.',
    input: buildMentorPrompt({
      mode,
      problem,
      code,
      language,
      errorMessage,
    }),
  });

  const answer = response.output_text?.trim();

  if (!answer) {
    throw new Error('AI Mentor returned an empty response.');
  }

  return answer;
};

module.exports = {
  mentor,
};