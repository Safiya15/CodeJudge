/**
 * Output Normalization & Comparison Utility
 * 
 * Standard in online judges:
 * 1. Normalizes CRLF (\r\n) and CR (\r) to standard LF (\n)
 * 2. Trims trailing whitespace from each line and trailing blank lines
 * 3. Compares expected and actual output string
 */

const normalizeOutput = (str) => {
  if (str === null || str === undefined) return '';
  
  return str
    .toString()
    .replace(/\r\n/g, '\n') // CRLF -> LF
    .replace(/\r/g, '\n')   // CR -> LF
    .split('\n')
    .map((line) => line.trimEnd()) // Trim trailing space per line
    .join('\n')
    .trimEnd(); // Trim trailing blank lines at end of output
};

const compareOutputs = (actual, expected) => {
  const normActual = normalizeOutput(actual);
  const normExpected = normalizeOutput(expected);
  return normActual === normExpected;
};

module.exports = {
  normalizeOutput,
  compareOutputs,
};
