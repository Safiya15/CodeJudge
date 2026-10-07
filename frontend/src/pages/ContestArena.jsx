import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import {
  Trophy,
  Clock,
  AlertCircle,
  ArrowLeft,
  Users,
  Code2,
  Radio,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';

export const ContestArena = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { socket, isConnected } = useSocket();

  const [contest, setContest] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('problems');
  const [timeRemaining, setTimeRemaining] = useState('');

  // Local registration state.
  // contest.isRegistered from the backend is also respected.
  const [isRegistered, setIsRegistered] = useState(false);
  const [hasEnteredContest, setHasEnteredContest] = useState(
  () => sessionStorage.getItem(`codejudge_contest_entered_${id}`) === 'true'
);

  // Used to refresh the contest timer every second.
  const [currentTime, setCurrentTime] = useState(Date.now());

  // ============================================================
  // 1. Fetch contest and initial leaderboard
  // ============================================================
  useEffect(() => {
    const fetchContestData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [contestRes, lbRes] = await Promise.all([
          api.getContestById(id),
          api.getContestLeaderboard(id),
        ]);

        const contestData = contestRes.data.contest;

        setContest(contestData);
        setLeaderboard(lbRes.data.leaderboard || []);

        // Respect registration state returned by backend.
        setIsRegistered(Boolean(contestData.isRegistered));
      } catch (err) {
        setError(err.message || 'Failed to load contest arena.');
      } finally {
        setLoading(false);
      }
    };

    fetchContestData();
  }, [id]);

  // ============================================================
  // 2. Keep current time updated every second
  // ============================================================
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // ============================================================
  // 3. Real-time WebSocket connection to contest room
  // ============================================================
  useEffect(() => {
    if (!socket) return;

    socket.emit('join:contest', id);
    console.log(`[Socket] Joined room contest:${id}`);

    const handleLeaderboardUpdate = (data) => {
      console.log('[Socket] Received live leaderboard update:', data);

      if (data.contestId === id) {
        setLeaderboard(data.leaderboard || []);
      }
    };

    socket.on('leaderboard:update', handleLeaderboardUpdate);

    return () => {
      socket.emit('leave:contest', id);
      socket.off('leaderboard:update', handleLeaderboardUpdate);
    };
  }, [socket, id]);

  // ============================================================
  // 4. Contest timer
  // ============================================================
  useEffect(() => {
    if (!contest) return;

    const formatTime = (ms) => {
      const totalSec = Math.max(0, Math.floor(ms / 1000));

      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;

      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(
        2,
        '0'
      )}:${String(secs).padStart(2, '0')}`;
    };

    const updateTimer = () => {
      const now = Date.now();

      const start = new Date(contest.startTime).getTime();
      const end = new Date(contest.endTime).getTime();

      if (now < start) {
        setTimeRemaining(`STARTS IN ${formatTime(start - now)}`);
      } else if (now < end) {
        setTimeRemaining(
          `LIVE — TIME REMAINING ${formatTime(end - now)}`
        );
      } else {
        setTimeRemaining('ENDED');
      }
    };

    updateTimer();

    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [contest, currentTime]);

  // ============================================================
  // 5. Register for contest
  // ============================================================
  const handleRegister = async () => {
  try {
    setError(null);

    await api.joinContest(id);

    // Immediately show REGISTERED
    setIsRegistered(true);

    // Refresh contest data
    try {
      const contestRes = await api.getContestById(id);

      if (contestRes?.contest) {
        setContest(contestRes.contest);
      }
    } catch (refreshError) {
      console.warn(
        'Contest registered, but refresh failed:',
        refreshError.message
      );
    }
  } catch (err) {
    setError(err.message || 'Failed to register for the contest.');
  }
};

  // ============================================================
  // 6. Loading
  // ============================================================
  if (loading) {
    return (
      <div className="container page-content loading-container">
        <div className="spinner"></div>
        <p>Entering Contest Arena...</p>
      </div>
    );
  }

  // ============================================================
  // 7. Error
  // ============================================================
  if (error || !contest) {
    return (
      <div className="container page-content">
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>
            {error || 'Contest arena could not be loaded.'}
          </span>
        </div>

        <Link to="/contests" className="btn btn-secondary mt-4">
          <ArrowLeft size={16} /> All Contests
        </Link>
      </div>
    );
  }

  // ============================================================
  // 8. Calculate contest state from actual timestamps
  // ============================================================
  const now = currentTime;

  const startTime = new Date(contest.startTime).getTime();
  const endTime = new Date(contest.endTime).getTime();

  const hasStarted = now >= startTime;
  const hasEnded = now >= endTime;

  const isUpcoming = !hasStarted;
  const isLive = hasStarted && !hasEnded;

  // If backend sends registration information, respect it.
  const registered =
    isRegistered || Boolean(contest.isRegistered);

  // ============================================================
  // 9. Contest status text
  // ============================================================
  let statusText = 'UPCOMING';
  let statusClass = 'status-ended';

  if (isLive) {
    statusText = 'LIVE';
    statusClass = 'status-live';
  } else if (hasEnded) {
    statusText = 'ENDED';
    statusClass = 'status-ended';
  }

  // ============================================================
  // 10. Start Contest destination
  // ============================================================
  const firstProblem = contest.problems?.[0];

  const firstProblemUrl = firstProblem
    ? `/problems/${firstProblem.problemId.slug}?contestId=${contest._id}`
    : `/contests/${contest._id}`;

  // ============================================================
  // 11. Render
  // ============================================================
  return (
    <div className="container page-content">

      {/* ========================================================
          Contest Top Banner
      ======================================================== */}
      <div className="arena-header card">
        <div className="arena-header-main">

          <Link to="/contests" className="back-link">
            <ArrowLeft size={14} />
            Back to Contests
          </Link>

          <div className="arena-title-row">
            <h1 className="arena-title">
              {contest.name}
            </h1>

            <span
              className={`contest-status-badge ${statusClass}`}
            >
              {isLive && (
                <span className="live-dot pulse"></span>
              )}

              <span>{statusText}</span>
            </span>
          </div>

          <div className="meta-chips">

            {/* Timer */}
            <span
              className={`meta-chip contest-timer ${
                isLive
                  ? 'contest-timer-live'
                  : 'contest-timer-ended'
              }`}
            >
              <Clock size={14} />
              <span>{timeRemaining}</span>
            </span>

            {/* Participants */}
            <span className="meta-chip">
              <Users size={14} />
              {contest.participantsCount || 0} Contestants
            </span>

            {/* WebSocket */}
            <span className="meta-chip">
              <Radio
                size={14}
                className={
                  isConnected
                    ? 'text-success'
                    : 'text-muted'
                }
              />

              <span>
                {isConnected
                  ? 'Live WebSocket Connected'
                  : 'Polling'}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================
          REGISTRATION / START MESSAGE
      ======================================================== */}

      {/* Upcoming + NOT registered */}
      {isUpcoming && !registered && (
        <div className="contest-action-banner card mt-4">
          <div className="contest-action-content">
            <div>
              <h3>Register for this contest</h3>

              <p>
                Register now. The problems will become available
                when the countdown reaches zero.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRegister}
            >
              <CheckCircle2 size={16} />
              Register
            </button>
          </div>
        </div>
      )}

      {/* Upcoming + REGISTERED */}
      {isUpcoming && registered && (
        <div className="contest-action-banner contest-registered-banner card mt-4">
          <div className="contest-action-content">
            <div>
              <h3>
                <CheckCircle2 size={18} />
                You are registered
              </h3>

              <p>
                Wait for the countdown to finish.
                You will be able to start the contest when
                the timer reaches zero.
              </p>
            </div>

            <div className="registered-badge">
              ✓ REGISTERED
            </div>
          </div>
        </div>
      )}

      {/* Live + registered */}
      {isLive && registered && !hasEnteredContest && (
        <div className="contest-action-banner contest-live-banner card mt-4">
          <div className="contest-action-content">
            <div>
              <h3>
                🎯 You can start the contest now
              </h3>

              <p>
                The countdown has finished. Problems are now
                unlocked and you can begin solving.
              </p>
            </div>

            {firstProblem && (
  <Link
    to={firstProblemUrl}
    className="btn btn-primary"
    onClick={() => {
      sessionStorage.setItem(
        `codejudge_contest_entered_${id}`,
        'true'
      );
      setHasEnteredContest(true);
    }}
  >
    <Code2 size={16} />
    Start Contest
  </Link>
)}
          </div>
        </div>
      )}

      {/* Live + NOT registered */}
      {isLive && !registered && (
        <div className="contest-action-banner card mt-4">
          <div className="contest-action-content">
            <div>
              <h3>Contest is live</h3>

              <p>
                You are not registered for this contest.
              </p>
            </div>

            <span className="registration-required-badge">
              Registration Required
            </span>
          </div>
        </div>
      )}

      {/* Ended */}
      {hasEnded && (
        <div className="contest-action-banner contest-ended-banner card mt-4">
          <div className="contest-action-content">
            <div>
              <h3>Contest Ended</h3>

              <p>
                The contest has finished. You can view the
                final leaderboard below.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActiveTab('leaderboard')}
            >
              <Trophy size={16} />
              View Final Leaderboard
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          Arena Navigation Tabs
      ======================================================== */}
      <div className="pane-nav-tabs mt-6">

        <button
          type="button"
          onClick={() => setActiveTab('problems')}
          className={`pane-tab-btn ${
            activeTab === 'problems' ? 'active' : ''
          }`}
        >
          <Code2 size={16} />
          <span>
            Problems ({contest.problems?.length || 0})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('leaderboard')}
          className={`pane-tab-btn ${
            activeTab === 'leaderboard' ? 'active' : ''
          }`}
        >
          <Trophy size={16} />
          <span>
            Live Leaderboard ({leaderboard.length})
          </span>
        </button>

      </div>

      {/* ========================================================
          TAB 1: PROBLEMS
      ======================================================== */}
      {activeTab === 'problems' && (
        <div className="arena-problems-view mt-4">

          {/* BEFORE CONTEST STARTS */}
          {isUpcoming ? (
            <div className="empty-state">

              <Clock
                size={48}
                className="empty-icon text-muted"
              />

              <h3>
                {registered
                  ? 'You Are Registered'
                  : 'Contest Has Not Started'}
              </h3>

              <p>
                {registered
                  ? 'You can start the contest when the countdown reaches zero.'
                  : 'Register for the contest first. Problems will be unlocked automatically when the countdown expires.'}
              </p>

              <div className="contest-waiting-timer">
                <Clock size={16} />
                <strong>{timeRemaining}</strong>
              </div>

            </div>
          ) : (
            /* LIVE OR ENDED */
            <div className="problems-table-wrapper">

              <table className="problems-table">

                <thead>
                  <tr>
                    <th style={{ width: '10%' }}>#</th>

                    <th style={{ width: '45%' }}>
                      Problem Title
                    </th>

                    <th style={{ width: '15%' }}>
                      Difficulty
                    </th>

                    <th style={{ width: '15%' }}>
                      Score
                    </th>

                    <th style={{ width: '15%' }}>
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>

                  {contest.problems?.map((cp, idx) => (

                    <tr key={idx}>

                      <td className="font-mono font-bold">
                        {String.fromCharCode(65 + idx)}
                      </td>

                      <td>
                        <Link
                          to={`/problems/${cp.problemId.slug}?contestId=${contest._id}`}
                          className="problem-title-link"
                        >
                          {cp.problemId.title}
                        </Link>
                      </td>

                      <td>
                        <span
                          className={`difficulty-badge badge-${cp.problemId.difficulty?.toLowerCase()}`}
                        >
                          {cp.problemId.difficulty?.toUpperCase()}
                        </span>
                      </td>

                      <td className="font-mono">
                        {cp.points} pts
                      </td>

                      <td>

                        {isLive && registered ? (
                          <Link
                            to={`/problems/${cp.problemId.slug}?contestId=${contest._id}`}
                            className="btn btn-secondary btn-sm"
                          >
                            <span>Solve</span>
                            <ExternalLink size={12} />
                          </Link>
                        ) : hasEnded ? (
                          <Link
                            to={`/problems/${cp.problemId.slug}?contestId=${contest._id}`}
                            className="btn btn-secondary btn-sm"
                          >
                            <span>View</span>
                            <ExternalLink size={12} />
                          </Link>
                        ) : (
                          <span className="text-muted text-xs">
                            Locked
                          </span>
                        )}

                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>
          )}

        </div>
      )}

      {/* ========================================================
          TAB 2: LIVE LEADERBOARD
      ======================================================== */}
      {activeTab === 'leaderboard' && (
        <div className="arena-leaderboard-view mt-4">

          <div className="leaderboard-legend">

            <div className="legend-item">
              <span className="legend-chip legend-solved">
                +X (time)
              </span>

              <span>
                Solved (Attempts & First Solve Time)
              </span>
            </div>

            <div className="legend-item">
              <span className="legend-chip legend-wrong">
                -X
              </span>

              <span>
                Failed Attempts (Penalty: 20 min/attempt)
              </span>
            </div>

          </div>

          {leaderboard.length === 0 ? (
            <div className="empty-state">

              <Trophy
                size={48}
                className="empty-icon text-muted"
              />

              <h3>No Submissions Yet</h3>

              <p>
                Solve problems to rank on the live contest
                leaderboard.
              </p>

            </div>
          ) : (
            <div className="problems-table-wrapper">

              <table className="problems-table leaderboard-table">

                <thead>
                  <tr>

                    <th style={{ width: '8%' }}>
                      Rank
                    </th>

                    <th style={{ width: '25%' }}>
                      Contestant
                    </th>

                    <th style={{ width: '12%' }}>
                      Solved
                    </th>

                    <th style={{ width: '15%' }}>
                      Penalty Time
                    </th>

                    {contest.problems?.map((cp, idx) => (
                      <th
                        key={idx}
                        className="text-center font-mono"
                        style={{ width: '10%' }}
                      >
                        {String.fromCharCode(65 + idx)}
                      </th>
                    ))}

                  </tr>
                </thead>

                <tbody>

                  {leaderboard.map((row) => {

                    const isCurrentUser =
                      user &&
                      user._id.toString() === row.userId;

                    return (
                      <tr
                        key={row.userId}
                        className={
                          isCurrentUser
                            ? 'current-user-row'
                            : ''
                        }
                      >

                        <td>
                          <span
                            className={`rank-badge ${
                              row.rank === 1
                                ? 'rank-gold'
                                : row.rank === 2
                                ? 'rank-silver'
                                : row.rank === 3
                                ? 'rank-bronze'
                                : ''
                            }`}
                          >
                            #{row.rank}
                          </span>
                        </td>

                        <td>
                          <span className="contestant-name">
                            {row.name}
                          </span>

                          {isCurrentUser && (
                            <span className="you-pill">
                              YOU
                            </span>
                          )}
                        </td>

                        <td className="font-mono font-bold text-success">
                          {row.problemsSolved}
                        </td>

                        <td className="font-mono text-muted">
                          {row.totalPenalty} min
                        </td>

                        {/* Per-problem breakdown */}
                        {contest.problems?.map((cp) => {

                          const pId =
                            cp.problemId._id ||
                            cp.problemId;

                          const detail =
                            row.problemDetails?.[
                              pId.toString()
                            ];

                          if (!detail) {
                            return (
                              <td
                                key={pId}
                                className="text-center text-muted text-xs"
                              >
                                —
                              </td>
                            );
                          }

                          if (detail.solved) {
                            return (
                              <td
                                key={pId}
                                className="text-center"
                              >
                                <div className="cell-solved">

                                  <span>
                                    +
                                    {detail.wrongAttempts > 0
                                      ? detail.wrongAttempts + 1
                                      : 1}
                                  </span>

                                  <span className="solve-min">
                                    {detail.solveTime}m
                                  </span>

                                </div>
                              </td>
                            );
                          }

                          if (detail.wrongAttempts > 0) {
                            return (
                              <td
                                key={pId}
                                className="text-center"
                              >
                                <span className="cell-failed">
                                  -{detail.wrongAttempts}
                                </span>
                              </td>
                            );
                          }

                          return (
                            <td
                              key={pId}
                              className="text-center text-muted text-xs"
                            >
                              —
                            </td>
                          );
                        })}

                      </tr>
                    );
                  })}

                </tbody>

              </table>

            </div>
          )}

        </div>
      )}

    </div>
  );
};