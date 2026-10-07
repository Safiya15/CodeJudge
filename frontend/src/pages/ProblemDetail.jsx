import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import Editor from '@monaco-editor/react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import {
  Clock,
  Cpu,
  Code2,
  ArrowLeft,
  Copy,
  Check,
  Play,
  Send,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Terminal,
  History,
  BookOpen,
  Radio,
  Trophy,
} from 'lucide-react';

const STARTER_TEMPLATES = {
  cpp: `#include <iostream>
#include <vector>
#include <string>

using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    // Read input from stdin and print solution to stdout
    return 0;
}
`,

  python: `import sys

def solve():
    lines = sys.stdin.read().splitlines()
    if not lines:
        return

    # Read input and print solution to stdout

if __name__ == '__main__':
    solve()
`,

  java: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        // Read input and print solution to stdout
    }
}
`,

  javascript: `const fs = require('fs');

function solve() {
    const input = fs.readFileSync(0, 'utf-8').trim();

    if (!input) return;

    // Read input and print solution to stdout
}

solve();
`,
};

export const ProblemDetail = () => {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();

  /*
   * If contestId exists, this problem is being opened
   * from a contest.
   */
  const contestId = searchParams.get('contestId');

  const { user } = useAuth();
  const { socket, isConnected } = useSocket();

  // ------------------------------------------------------------
  // Problem state
  // ------------------------------------------------------------

  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);

  // ------------------------------------------------------------
  // Contest state
  // ------------------------------------------------------------

  const [contest, setContest] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState('');

  // ------------------------------------------------------------
  // Pane tabs
  // 'statement' | 'submissions'
  // ------------------------------------------------------------

  const [leftTab, setLeftTab] = useState('statement');

  const [mySubmissions, setMySubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] =
    useState(false);

  // ------------------------------------------------------------
  // Editor state
  // ------------------------------------------------------------

  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState('');

  // ------------------------------------------------------------
  // Run execution states
  // ------------------------------------------------------------

  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState(null);
  const [runError, setRunError] = useState(null);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);

  // ------------------------------------------------------------
  // Submit execution states
  // ------------------------------------------------------------

  const [submitting, setSubmitting] = useState(false);
  const [activeSubmission, setActiveSubmission] = useState(null);

  const pollingRef = useRef(null);

  // ------------------------------------------------------------
  // Console mode
  // 'run' | 'submit' | 'idle'
  // ------------------------------------------------------------

  const [consoleMode, setConsoleMode] = useState('idle');

  // ============================================================
  // DRAFT STORAGE
  // ============================================================
  /*
   * Practice and contest drafts use different localStorage keys.
   *
   * Practice:
   * codejudge_draft_<problemId>_<language>
   *
   * Contest:
   * codejudge_contest_<contestId>_<problemId>_<language>
   *
   * This prevents old practice code from appearing inside
   * contests.
   */

 const getDraftKey = (problemId, lang) => {
  const userId = user?._id || user?.id || 'guest';

  if (contestId) {
    return `codejudge_contest_${contestId}_${userId}_${problemId}_${lang}`;
  }

  return `codejudge_draft_${userId}_${problemId}_${lang}`;
};

  // ============================================================
  // REAL-TIME WEBSOCKET LISTENER
  // ============================================================

  useEffect(() => {
    if (!socket) return;

    const handleSubmissionUpdate = (data) => {
      console.log(
        '[WebSocket] Real-time submission event received:',
        data
      );

      setActiveSubmission((prev) => {
        if (!prev || prev._id === data.submissionId) {
          return {
            ...prev,
            _id: data.submissionId,
            status: data.status,

            verdict:
              data.verdict !== undefined
                ? data.verdict
                : prev?.verdict,

            runtimeMs:
              data.runtimeMs !== undefined
                ? data.runtimeMs
                : prev?.runtimeMs,

            memoryKb:
              data.memoryKb !== undefined
                ? data.memoryKb
                : prev?.memoryKb,

            failedTestIndex:
              data.failedTestIndex !== undefined
                ? data.failedTestIndex
                : prev?.failedTestIndex,
          };
        }

        return prev;
      });

      if (
        data.status === 'Completed' ||
        data.status === 'Failed'
      ) {
        setSubmitting(false);

        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }

        fetchMySubmissions();
      }
    };

    socket.on(
      'submission:update',
      handleSubmissionUpdate
    );

    return () => {
      socket.off(
        'submission:update',
        handleSubmissionUpdate
      );
    };
  }, [socket]);

  // ============================================================
  // LOAD PROBLEM
  // ============================================================

  useEffect(() => {
    const fetchProblem = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await api.getProblemBySlug(slug);

        const prob = res.data.problem;

        setProblem(prob);

        const defaultLang =
          prob.allowedLanguages?.[0] || 'cpp';

        setLanguage(defaultLang);

        /*
         * Load contest-specific draft when inside a contest.
         * Otherwise load normal practice draft.
         */
        const savedDraft = localStorage.getItem(
          getDraftKey(prob._id, defaultLang)
        );

        setCode(
          savedDraft ||
            STARTER_TEMPLATES[defaultLang] ||
            '// Write code here'
        );
      } catch (err) {
        setError(
          err.message || 'Problem not found'
        );
      } finally {
        setLoading(false);
      }
    };

    fetchProblem();

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
 }, [slug, contestId, user]);
  // ============================================================
  // LOAD CONTEST
  // ============================================================

  useEffect(() => {
    if (!contestId) {
      setContest(null);
      setTimeRemaining('');
      return;
    }

    const fetchContest = async () => {
      try {
        const res =
          await api.getContestById(contestId);

        setContest(res.data.contest);
      } catch (err) {
        console.warn(
          'Failed to load contest:',
          err.message
        );

        setContest(null);
        setTimeRemaining('');
      }
    };

    fetchContest();
  }, [contestId]);

  // ============================================================
  // CONTEST COUNTDOWN TIMER
  // ============================================================

  useEffect(() => {
    if (!contest) return;

    const formatTime = (ms) => {
      const totalSec = Math.max(
        0,
        Math.floor(ms / 1000)
      );

      const hours = Math.floor(
        totalSec / 3600
      );

      const mins = Math.floor(
        (totalSec % 3600) / 60
      );

      const secs = totalSec % 60;

      return `${String(hours).padStart(
        2,
        '0'
      )}:${String(mins).padStart(
        2,
        '0'
      )}:${String(secs).padStart(
        2,
        '0'
      )}`;
    };

    const updateTimer = () => {
      const now = Date.now();

      const start = new Date(
        contest.startTime
      ).getTime();

      const end = new Date(
        contest.endTime
      ).getTime();

      if (now < start) {
        setTimeRemaining(
          `STARTS IN ${formatTime(
            start - now
          )}`
        );
      } else if (now < end) {
        setTimeRemaining(
          `LIVE — TIME REMAINING ${formatTime(
            end - now
          )}`
        );
      } else {
        setTimeRemaining('ENDED');
      }
    };

    // Run immediately.
    updateTimer();

    // Update every second.
    const interval = setInterval(
      updateTimer,
      1000
    );

    return () => clearInterval(interval);
  }, [contest]);

  // ============================================================
  // LOAD MY SUBMISSIONS
  // ============================================================

  const fetchMySubmissions = async () => {
    if (!problem || !user) return;

    setLoadingSubmissions(true);

    /*
     * Clear the existing list first.
     *
     * This prevents old practice submissions from
     * remaining visible while contest submissions load.
     */
    setMySubmissions([]);

    try {
      const res =
        await api.getSubmissions({
          problemId: problem._id,

          /*
           * IMPORTANT:
           *
           * Practice:
           * contestId = undefined
           *
           * Contest:
           * contestId = actual contest ID
           *
           * This keeps practice and contest
           * submission histories separate.
           */
          contestId:
            contestId || undefined,

          mine: 'true',
        });

      setMySubmissions(
        res.data.submissions || []
      );
    } catch (err) {
      console.warn(
        'Failed to load past submissions:',
        err.message
      );
    } finally {
      setLoadingSubmissions(false);
    }
  };

  // ============================================================
  // REFRESH SUBMISSIONS WHEN TAB / CONTEST CHANGES
  // ============================================================

  useEffect(() => {
    if (
      leftTab === 'submissions' &&
      problem &&
      user
    ) {
      fetchMySubmissions();
    }
  }, [
    leftTab,
    problem,
    user,
    contestId,
  ]);

  // ============================================================
  // HANDLE LANGUAGE CHANGE
  // ============================================================

  const handleLanguageChange = (newLang) => {
    if (problem) {
      /*
       * Save current language using the correct
       * practice/contest storage key.
       */
      localStorage.setItem(
        getDraftKey(
          problem._id,
          language
        ),
        code
      );
    }

    setLanguage(newLang);

    /*
     * Load the correct practice/contest draft.
     */
    const savedDraft =
      problem &&
      localStorage.getItem(
        getDraftKey(
          problem._id,
          newLang
        )
      );

    setCode(
      savedDraft ||
        STARTER_TEMPLATES[newLang] ||
        '// Write code here'
    );
  };

  // ============================================================
  // HANDLE EDITOR CODE CHANGE
  // ============================================================

  const handleEditorChange = (newCode) => {
    const updatedCode =
      newCode || '';

    setCode(updatedCode);

    if (problem) {
      localStorage.setItem(
        getDraftKey(
          problem._id,
          language
        ),
        updatedCode
      );
    }
  };

  // ============================================================
  // COPY SAMPLE INPUT / OUTPUT
  // ============================================================

  const copyToClipboard = (
    text,
    idx
  ) => {
    navigator.clipboard.writeText(text);

    setCopiedIndex(idx);

    setTimeout(
      () => setCopiedIndex(null),
      1500
    );
  };

  // ============================================================
  // RUN CODE
  // ============================================================

  const handleRunCode = async () => {
    if (!user) {
      setRunError(
        'Please sign in to run code.'
      );

      return;
    }

    setConsoleMode('run');
    setRunning(true);
    setRunError(null);
    setRunResults(null);
    setActiveCaseIndex(0);

    try {
      const res =
        await api.runCode({
          problemId: problem._id,
          language,
          code,
        });

      setRunResults(res.data);
    } catch (err) {
      setRunError(
        err.message ||
          'Execution error during Run.'
      );
    } finally {
      setRunning(false);
    }
  };

  // ============================================================
  // SUBMIT CODE
  // ============================================================

  const handleSubmitCode = async () => {
    if (!user) {
      setRunError(
        'Please sign in to submit your solution.'
      );

      return;
    }

    setConsoleMode('submit');
    setSubmitting(true);
    setRunError(null);

    setActiveSubmission({
      status: 'Pending',
      verdict: null,
    });

    try {
      const res =
        await api.submitCode({
          problemId: problem._id,

          /*
           * IMPORTANT:
           *
           * Contest submissions carry contestId.
           * Practice submissions do not.
           */
          contestId:
            contestId || undefined,

          language,
          code,
        });

      const submissionId =
        res.data.submissionId;

      setActiveSubmission({
        _id: submissionId,
        status: res.data.status,
        verdict: null,
      });

      // Clear any previous polling.
      if (pollingRef.current) {
        clearInterval(
          pollingRef.current
        );
      }

      // Poll until Completed or Failed.
      pollingRef.current =
        setInterval(
          async () => {
            try {
              const checkRes =
                await api.getSubmission(
                  submissionId
                );

              const sub =
                checkRes.data.submission;

              setActiveSubmission(
                sub
              );

              if (
                sub.status ===
                  'Completed' ||
                sub.status === 'Failed'
              ) {
                clearInterval(
                  pollingRef.current
                );

                pollingRef.current =
                  null;

                setSubmitting(false);

                fetchMySubmissions();
              }
            } catch (pollErr) {
              console.warn(
                'Submission poll error:',
                pollErr.message
              );
            }
          },
          750
        );
    } catch (err) {
      setRunError(
        err.message ||
          'Failed to submit code.'
      );

      setSubmitting(false);
    }
  };

  // ============================================================
  // DIFFICULTY BADGE
  // ============================================================

  const getDifficultyBadge = (
    diff
  ) => {
    const cls = {
      easy: 'badge-easy',
      medium: 'badge-medium',
      hard: 'badge-hard',
    }[
      diff?.toLowerCase()
    ] || 'badge-neutral';

    return (
      <span
        className={`difficulty-badge ${cls}`}
      >
        {diff?.toUpperCase()}
      </span>
    );
  };

  // ============================================================
  // VERDICT BADGE
  // ============================================================

  const getVerdictBadge = (
    verdict,
    status
  ) => {
    if (status === 'Pending') {
      return (
        <span className="verdict-pill verdict-pending">
          <Clock
            size={14}
            className="spin"
          />
          Queued (Pending)
        </span>
      );
    }

    if (status === 'Processing') {
      return (
        <span className="verdict-pill verdict-processing">
          <Cpu
            size={14}
            className="spin"
          />
          Running in Sandbox...
        </span>
      );
    }

    if (verdict === 'Accepted') {
      return (
        <span className="verdict-pill verdict-accepted">
          <CheckCircle2 size={14} />
          Accepted
        </span>
      );
    }

    if (
      verdict === 'Wrong Answer'
    ) {
      return (
        <span className="verdict-pill verdict-wa">
          <XCircle size={14} />
          Wrong Answer
        </span>
      );
    }

    if (
      verdict ===
      'Time Limit Exceeded'
    ) {
      return (
        <span className="verdict-pill verdict-tle">
          <Clock size={14} />
          Time Limit Exceeded
        </span>
      );
    }

    return (
      <span className="verdict-pill verdict-err">
        <AlertCircle size={14} />
        {verdict ||
          'Evaluation Error'}
      </span>
    );
  };

  // ============================================================
  // LOADING STATE
  // ============================================================

  if (loading) {
    return (
      <div className="container page-content loading-container">
        <div className="spinner"></div>

        <p>
          Loading problem workspace...
        </p>
      </div>
    );
  }

  // ============================================================
  // ERROR STATE
  // ============================================================

  if (error || !problem) {
    return (
      <div className="container page-content">
        <div className="alert alert-error">
          <AlertCircle size={18} />

          <span>
            {error ||
              'Problem could not be loaded.'}
          </span>
        </div>

        <Link
          to="/problems"
          className="btn btn-secondary mt-4"
        >
          <ArrowLeft size={16} />
          Back to Problems
        </Link>
      </div>
    );
  }

  // ============================================================
  // MAIN PROBLEM PAGE
  // ============================================================

  return (
    <div className="container-fluid problem-page-layout">

      {/* ======================================================
          LEFT COLUMN
          Problem Statement / Submissions
          ====================================================== */}

      <div className="problem-statement-pane">

        {/* ====================================================
            CONTEST TIMER

            IMPORTANT:
            This is OUTSIDE the tabs, so it remains visible
            on both Problem Description and My Submissions.
            ==================================================== */}

        {contestId &&
          timeRemaining && (
            <div className="contest-page-timer">
              <Clock size={16} />

              <span>
                {timeRemaining}
              </span>
            </div>
          )}

        {/* ====================================================
            PANE TABS
            ==================================================== */}

        <div className="pane-nav-tabs">

          <button
            onClick={() =>
              setLeftTab(
                'statement'
              )
            }
            className={`pane-tab-btn ${
              leftTab ===
              'statement'
                ? 'active'
                : ''
            }`}
          >
            <BookOpen size={15} />

            <span>
              Problem Description
            </span>
          </button>

          <button
            onClick={() =>
              setLeftTab(
                'submissions'
              )
            }
            className={`pane-tab-btn ${
              leftTab ===
              'submissions'
                ? 'active'
                : ''
            }`}
          >
            <History size={15} />

            <span>
              My Submissions
            </span>
          </button>
        </div>

        {/* ====================================================
            PROBLEM STATEMENT
            ==================================================== */}

        {leftTab === 'statement' ? (
          <div>

            {/* Statement Header */}

            <div className="statement-header">

              {contestId ? (
                <Link
                  to={`/contests/${contestId}`}
                  className="back-link back-link-contest"
                >
                  <Trophy size={15} />

                  <span>
                    Back to Contest Arena
                  </span>
                </Link>
              ) : (
                <Link
                  to="/problems"
                  className="back-link"
                >
                  <ArrowLeft size={16} />

                  All Problems
                </Link>
              )}

              <div className="title-row">

                <h1 className="problem-title">
                  {problem.title}
                </h1>

                {getDifficultyBadge(
                  problem.difficulty
                )}
              </div>

              {/* Normal Problem Metadata */}

              <div className="meta-chips">

                <span className="meta-chip">
                  <Clock size={14} />

                  Time:{' '}
                  {problem.timeLimitMs}ms
                </span>

                <span className="meta-chip">
                  <Cpu size={14} />

                  Memory:{' '}
                  {problem.memoryLimitMb}MB
                </span>

                <span className="meta-chip">
                  <Code2 size={14} />

                  Allowed:{' '}
                  {problem.allowedLanguages?.join(
                    ', '
                  )}
                </span>

              </div>

              {problem.tags &&
                problem.tags.length >
                  0 && (
                  <div className="tag-list mt-2">

                    {problem.tags.map(
                      (t) => (
                        <span
                          key={t}
                          className="tag-chip"
                        >
                          #{t}
                        </span>
                      )
                    )}

                  </div>
                )}

            </div>

            <hr className="divider" />

            {/* Markdown Statement */}

            <div className="markdown-content">
              <ReactMarkdown>
                {problem.statement}
              </ReactMarkdown>
            </div>

            {/* ==================================================
                SAMPLE TEST CASES
                ================================================== */}

            <div className="samples-section">

              <h3>
                Sample Test Cases
              </h3>

              {problem.sampleTestCases &&
              problem.sampleTestCases.length >
                0 ? (
                problem.sampleTestCases.map(
                  (tc, idx) => (
                    <div
                      key={idx}
                      className="sample-card"
                    >

                      <div className="sample-header">
                        <span className="sample-label">
                          Sample Case #
                          {idx + 1}
                        </span>
                      </div>

                      <div className="sample-grid">

                        {/* Input */}

                        <div className="sample-block">

                          <div className="sample-block-title">

                            <span>
                              Input:
                            </span>

                            <button
                              className="btn-copy"
                              onClick={() =>
                                copyToClipboard(
                                  tc.input,
                                  `in-${idx}`
                                )
                              }
                              title="Copy input"
                            >
                              {copiedIndex ===
                              `in-${idx}` ? (
                                <Check
                                  size={13}
                                />
                              ) : (
                                <Copy
                                  size={13}
                                />
                              )}
                            </button>

                          </div>

                          <pre className="sample-code">
                            {tc.input ||
                              '(empty)'}
                          </pre>

                        </div>

                        {/* Expected Output */}

                        <div className="sample-block">

                          <div className="sample-block-title">

                            <span>
                              Expected Output:
                            </span>

                            <button
                              className="btn-copy"
                              onClick={() =>
                                copyToClipboard(
                                  tc.expectedOutput,
                                  `out-${idx}`
                                )
                              }
                              title="Copy expected output"
                            >
                              {copiedIndex ===
                              `out-${idx}` ? (
                                <Check
                                  size={13}
                                />
                              ) : (
                                <Copy
                                  size={13}
                                />
                              )}
                            </button>

                          </div>

                          <pre className="sample-code">
                            {
                              tc.expectedOutput
                            }
                          </pre>

                        </div>

                      </div>
                    </div>
                  )
                )
              ) : (
                <p className="text-muted text-sm">
                  No sample test cases
                  provided.
                </p>
              )}

            </div>
          </div>
        ) : (

          /* ====================================================
             MY SUBMISSIONS HISTORY
             ==================================================== */

          <div className="submissions-history-view">

            <h2 className="history-title">
              Submission History
            </h2>

            {loadingSubmissions ? (
              <div className="loading-container">

                <div className="spinner"></div>

                <p>
                  Loading submission logs...
                </p>

              </div>
            ) : mySubmissions.length ===
              0 ? (
              <div className="empty-state">

                <History
                  size={40}
                  className="empty-icon"
                />

                <h3>
                  No Submissions Yet
                </h3>

                <p>
                  Submit your solution to
                  see judging verdicts and
                  resource metrics here.
                </p>

              </div>
            ) : (
              <div className="history-table-wrapper">

                <table className="problems-table">

                  <thead>
                    <tr>

                      <th>
                        Status / Verdict
                      </th>

                      <th>
                        Language
                      </th>

                      <th>
                        Runtime
                      </th>

                      <th>
                        Memory
                      </th>

                      <th>
                        Time
                      </th>

                    </tr>
                  </thead>

                  <tbody>

                    {mySubmissions.map(
                      (sub) => (
                        <tr
                          key={sub._id}
                        >

                          <td>
                            {getVerdictBadge(
                              sub.verdict,
                              sub.status
                            )}
                          </td>

                          <td>
                            <span className="lang-pill">
                              {sub.language?.toUpperCase()}
                            </span>
                          </td>

                          <td>
                            {sub.runtimeMs !=
                            null
                              ? `${sub.runtimeMs} ms`
                              : '—'}
                          </td>

                          <td>
                            {sub.memoryKb !=
                            null
                              ? `${sub.memoryKb} KB`
                              : '—'}
                          </td>

                          <td className="text-muted text-xs">
                            {new Date(
                              sub.createdAt
                            ).toLocaleTimeString()}
                          </td>

                        </tr>
                      )
                    )}

                  </tbody>

                </table>

              </div>
            )}

          </div>
        )}
      </div>

      {/* ======================================================
          RIGHT COLUMN
          Monaco Editor + Console
          ====================================================== */}

      <div className="code-workspace-pane">

        {/* ====================================================
            EDITOR TOOLBAR
            ==================================================== */}

        <div className="editor-toolbar">

          <div className="toolbar-left">

            <label className="text-xs text-muted">
              Language:
            </label>

            <select
              value={language}
              onChange={(e) =>
                handleLanguageChange(
                  e.target.value
                )
              }
              className="select-lang"
            >
              {problem.allowedLanguages?.map(
                (lang) => (
                  <option
                    key={lang}
                    value={lang}
                  >
                    {lang.toUpperCase()}
                  </option>
                )
              )}
            </select>

          </div>

          <div className="toolbar-actions">

            {/* Run */}

            <button
              onClick={
                handleRunCode
              }
              disabled={
                running ||
                submitting
              }
              className="btn btn-secondary btn-sm"
              title="Run code against visible sample cases only"
            >
              <Play
                size={14}
                className={
                  running
                    ? 'spin'
                    : ''
                }
              />

              <span>
                {running
                  ? 'Running...'
                  : 'Run'}
              </span>
            </button>

            {/* Submit */}

            <button
              onClick={
                handleSubmitCode
              }
              disabled={
                running ||
                submitting
              }
              className="btn btn-primary btn-sm"
              title="Submit solution to judge queue for full evaluation"
            >
              <Send
                size={14}
                className={
                  submitting
                    ? 'spin'
                    : ''
                }
              />

              <span>
                {submitting
                  ? 'Evaluating...'
                  : 'Submit'}
              </span>
            </button>

          </div>
        </div>

        {/* ====================================================
            MONACO EDITOR
            ==================================================== */}

        <div className="monaco-wrapper">

          <Editor
            height="100%"
            theme="vs-dark"
            language={
              language === 'cpp'
                ? 'cpp'
                : language
            }
            value={code}
            onChange={
              handleEditorChange
            }
            options={{
              fontSize: 14,

              minimap: {
                enabled: false,
              },

              scrollBeyondLastLine:
                false,

              automaticLayout:
                true,

              tabSize: 4,

              lineNumbers: 'on',

              folding: true,
            }}
          />

        </div>

        {/* ====================================================
            CONSOLE / OUTPUT DRAWER
            ==================================================== */}

        <div className="console-drawer">

          <div className="console-header">

            <div className="console-title">

              <Terminal size={14} />

              <span>
                {consoleMode ===
                'submit'
                  ? 'Contest Judge Queue Console'
                  : 'Execution Console'}
              </span>

              {consoleMode ===
                'submit' && (
                <span
                  className={`ws-badge ${
                    isConnected
                      ? 'ws-badge-live'
                      : 'ws-badge-offline'
                  }`}
                >
                  <Radio
                    size={11}
                    className={
                      isConnected
                        ? 'pulse'
                        : ''
                    }
                  />

                  <span>
                    {isConnected
                      ? 'Real-time WebSocket'
                      : 'Polling'}
                  </span>

                </span>
              )}

            </div>

            {consoleMode ===
              'run' &&
              runResults && (
                <div className="console-summary">

                  {runResults.passed ? (
                    <span className="summary-passed">
                      All Sample Cases
                      Passed
                    </span>
                  ) : (
                    <span className="summary-failed">
                      Sample Cases
                      Failed
                    </span>
                  )}

                </div>
              )}

          </div>

          <div className="console-body">

            {/* ==================================================
                RUN / SUBMIT ERROR
                ================================================== */}

            {runError && (
              <div className="alert alert-error">

                <AlertCircle size={16} />

                <span>
                  {runError}
                </span>

              </div>
            )}

            {/* ==================================================
                SUBMIT MODE
                ================================================== */}

            {consoleMode ===
              'submit' &&
              activeSubmission && (
                <div className="submission-status-card">

                  <div className="submit-status-header">

                    <div className="submit-verdict-banner">

                      {getVerdictBadge(
                        activeSubmission.verdict,
                        activeSubmission.status
                      )}

                    </div>

                    {activeSubmission.failedTestIndex && (
                      <span className="failed-index-pill">
                        Failed on Test #
                        {
                          activeSubmission.failedTestIndex
                        }
                      </span>
                    )}

                  </div>

                  <div className="submit-meta-grid">

                    <div className="submit-metric-card">

                      <span className="metric-label">
                        Queue Status
                      </span>

                      <span className="metric-value font-mono">
                        {
                          activeSubmission.status
                        }
                      </span>

                    </div>

                    <div className="submit-metric-card">

                      <span className="metric-label">
                        Max Runtime
                      </span>

                      <span className="metric-value font-mono">

                        {activeSubmission.runtimeMs !=
                        null
                          ? `${activeSubmission.runtimeMs} ms`
                          : '—'}

                      </span>

                    </div>

                    <div className="submit-metric-card">

                      <span className="metric-label">
                        Peak Memory
                      </span>

                      <span className="metric-value font-mono">

                        {activeSubmission.memoryKb !=
                        null
                          ? `${activeSubmission.memoryKb} KB`
                          : '—'}

                      </span>

                    </div>

                  </div>

                  {activeSubmission.status ===
                    'Completed' && (
                    <div className="submit-completion-note">

                      {activeSubmission.verdict ===
                      'Accepted' ? (
                        <p className="text-success text-sm">
                          🎉 Great job! Your
                          solution passed all
                          test cases.
                        </p>
                      ) : (
                        <p className="text-danger text-sm">
                          Submission finished
                          with verdict "
                          {
                            activeSubmission.verdict
                          }
                          ". Review your
                          logic and submit
                          again.
                        </p>
                      )}

                    </div>
                  )}

                </div>
              )}

            {/* ==================================================
                RUN MODE
                ================================================== */}

            {consoleMode ===
              'run' && (
              <div>

                {running && (
                  <div className="console-loading">

                    <div className="spinner"></div>

                    <span>
                      Executing sample test
                      cases in sandbox...
                    </span>

                  </div>
                )}

                {!running &&
                  runResults && (
                    <div className="run-results-view">

                      <div className="case-tabs">

                        {runResults.results?.map(
                          (
                            res,
                            idx
                          ) => (
                            <button
                              key={idx}
                              onClick={() =>
                                setActiveCaseIndex(
                                  idx
                                )
                              }
                              className={`case-tab-btn ${
                                activeCaseIndex ===
                                idx
                                  ? 'active'
                                  : ''
                              }`}
                            >

                              <span
                                className={`status-dot dot-${res.status
                                  .toLowerCase()
                                  .replace(
                                    /\s+/g,
                                    '-'
                                  )}`}
                              ></span>

                              Case{' '}
                              {
                                res.caseIndex
                              }

                            </button>
                          )
                        )}

                      </div>

                      {runResults.results?.[
                        activeCaseIndex
                      ] && (
                        <div className="active-case-details">

                          <div className="case-status-row">

                            {getVerdictBadge(
                              runResults
                                .results[
                                activeCaseIndex
                              ].status,
                              'Completed'
                            )}

                            <div className="case-metrics">

                              {runResults
                                .results[
                                activeCaseIndex
                              ].runtimeMs !=
                                null && (
                                <span className="metric-chip">

                                  <Clock
                                    size={12}
                                  />

                                  {
                                    runResults
                                      .results[
                                      activeCaseIndex
                                    ]
                                      .runtimeMs
                                  }{' '}
                                  ms

                                </span>
                              )}

                              {runResults
                                .results[
                                activeCaseIndex
                              ].memoryKb !=
                                null && (
                                <span className="metric-chip">

                                  <Cpu
                                    size={12}
                                  />

                                  {
                                    runResults
                                      .results[
                                      activeCaseIndex
                                    ]
                                      .memoryKb
                                  }{' '}
                                  KB

                                </span>
                              )}

                            </div>

                          </div>

                          {runResults
                            .results[
                            activeCaseIndex
                          ].compileError && (
                            <div className="compile-error-box">

                              <div className="error-title">
                                Compiler
                                Diagnostics:
                              </div>

                              <pre>
                                {
                                  runResults
                                    .results[
                                    activeCaseIndex
                                  ]
                                    .compileError
                                }
                              </pre>

                            </div>
                          )}

                          <div className="io-compare-grid">

                            <div className="io-box">

                              <div className="io-label">
                                Input
                              </div>

                              <pre className="io-content">
                                {
                                  runResults
                                    .results[
                                    activeCaseIndex
                                  ].input ||
                                  '(empty)'
                                }
                              </pre>

                            </div>

                            <div className="io-box">

                              <div className="io-label">
                                Expected Output
                              </div>

                              <pre className="io-content">
                                {
                                  runResults
                                    .results[
                                    activeCaseIndex
                                  ]
                                    .expectedOutput
                                }
                              </pre>

                            </div>

                            <div className="io-box">

                              <div className="io-label">
                                Your Output
                                (stdout)
                              </div>

                              <pre
                                className={`io-content ${
                                  runResults
                                    .results[
                                    activeCaseIndex
                                  ].status ===
                                  'Wrong Answer'
                                    ? 'io-mismatch'
                                    : ''
                                }`}
                              >
                                {
                                  runResults
                                    .results[
                                    activeCaseIndex
                                  ]
                                    .actualOutput ||
                                  '(no stdout)'
                                }
                              </pre>

                            </div>

                          </div>

                        </div>
                      )}

                    </div>
                  )}

              </div>
            )}

            {/* ==================================================
                IDLE CONSOLE
                ================================================== */}

            {consoleMode ===
              'idle' &&
              !runError && (
                <div className="console-idle">

                  <p>
                    Click "Run" for sample
                    tests, or "Submit" to
                    judge against all hidden
                    contest tests.
                  </p>

                </div>
              )}

          </div>
        </div>
      </div>
    </div>
  );
};