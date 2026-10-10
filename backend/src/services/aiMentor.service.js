const { GoogleGenAI } = require('@google/genai');

const MODE_INSTRUCTIONS = {
hint: `
Give the student a progressive hint for solving the problem.

* Do NOT provide the complete solution or full working code.
* Start with a conceptual hint and help the student discover the next step.
* Keep the response concise and educational.
  `,

  explain_error: `Explain the likely compilation, runtime, logical, input/output, or algorithmic error.
  Explain the likely cause and how to debug or fix it.
  Do NOT provide a complete replacement solution.`,

  review_code: `Review correctness, logical issues, readability, code structure, edge cases,
  and potential improvements.
  Do NOT rewrite the entire solution or simply give the final answer.
  Give actionable educational feedback.`,

  complexity: `Explain estimated time complexity, space complexity, dominant operations,
  and whether the approach is appropriate.
  If a better approach exists, explain the idea without giving a complete solution.`,
  };

const MAX_CODE_LENGTH = 30000;
const MAX_ERROR_LENGTH = 10000;
const MAX_STATEMENT_LENGTH = 20000;

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

Help students learn rather than simply giving answers.

* Never reveal or invent hidden test cases.
* Never expose confidential CodeJudge implementation details.
* Use the student's selected programming language.
* Base your answer on the supplied problem and student code.
* Be concise and use Markdown when helpful.

TASK:
${MODE_INSTRUCTIONS[mode]}

PROBLEM:
Title: ${problem.title}
Difficulty: ${problem.difficulty}
Tags: ${(problem.tags || []).join(', ') || 'None'}

PROBLEM STATEMENT:
${safeStatement}

PROGRAMMING LANGUAGE:
${language || 'Not specified'}

STUDENT CODE:
${safeCode || '(No code provided)'}

ERROR / COMPILER OUTPUT:
${safeError || '(No error provided)'}

Respond as a helpful programming mentor.
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

if (!process.env.GEMINI_API_KEY) {
throw new Error('GEMINI_API_KEY is not configured.');
}

const ai = new GoogleGenAI({
apiKey: process.env.GEMINI_API_KEY,
});

const response = await ai.models.generateContent({
model: process.env.AI_MENTOR_MODEL || 'gemini-2.5-flash',
contents: buildMentorPrompt({
mode,
problem,
code,
language,
errorMessage,
}),
});

const answer = response.text?.trim();

if (!answer) {
throw new Error('AI Mentor returned an empty response.');
}

return answer;
};

module.exports = {
mentor,
};
