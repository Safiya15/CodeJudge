import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import {
  Trophy,
  Calendar,
  Clock,
  Users,
  ChevronRight,
  AlertCircle,
  PlusCircle,
  CheckCircle,
} from 'lucide-react';

export const ContestList = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'Live' | 'Upcoming' | 'Ended'
  const [joiningId, setJoiningId] = useState(null);

  const fetchContests = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getContests();
      setContests(res.data.contests);
    } catch (err) {
      setError(err.message || 'Failed to load contests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContests();
  }, []);

  const handleJoinContest = async (contestId) => {
    if (!user) {
      navigate('/login');
      return;
    }

    setJoiningId(contestId);
    try {
      await api.joinContest(contestId);
      navigate(`/contests/${contestId}`);
    } catch (err) {
      setError(err.message || 'Failed to join contest.');
    } finally {
      setJoiningId(null);
    }
  };

  const filteredContests = contests.filter((c) => {
    if (filter === 'ALL') return true;
    return c.status === filter;
  });

  const getStatusBadge = (status) => {
    if (status === 'Live') {
      return (
        <span className="contest-status-badge status-live">
          <span className="live-dot pulse"></span>
          <span>LIVE NOW</span>
        </span>
      );
    }
    if (status === 'Upcoming') {
      return (
        <span className="contest-status-badge status-upcoming">
          <Clock size={12} />
          <span>UPCOMING</span>
        </span>
      );
    }
    return (
      <span className="contest-status-badge status-ended">
        <span>ENDED</span>
      </span>
    );
  };

  const formatDuration = (startTime, endTime) => {
    const diffMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
    if (hours > 0) return `${hours} hours`;
    return `${mins} minutes`;
  };

  return (
    <div className="container page-content">
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title flex-center gap-2">
            <Trophy className="brand-icon" size={28} />
            <span>Contest Arena</span>
          </h1>
          <p className="page-subtitle">
            Compete in real-time collegiate coding contests and climb the live leaderboard.
          </p>
        </div>

        {isAdmin && (
          <Link to="/admin/create-contest" className="btn btn-primary btn-sm">
            <PlusCircle size={16} />
            <span>Schedule Contest</span>
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="filter-bar">
        <div className="difficulty-tabs">
          {[
            { id: 'ALL', label: 'All Contests' },
            { id: 'Live', label: 'Live Now' },
            { id: 'Upcoming', label: 'Upcoming' },
            { id: 'Ended', label: 'Past Contests' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`tab-btn ${filter === tab.id ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading contests...</p>
        </div>
      ) : filteredContests.length === 0 ? (
        <div className="empty-state">
          <Trophy size={48} className="empty-icon" />
          <h3>No contests found in this view</h3>
          <p>Check back soon or look under other tabs.</p>
        </div>
      ) : (
        <div className="contest-grid">
          {filteredContests.map((c) => (
            <div key={c._id} className="contest-card">
              <div className="contest-card-header">
                <h3 className="contest-name">{c.name}</h3>
                {getStatusBadge(c.status)}
              </div>

              <div className="contest-meta-list">
                <div className="contest-meta-item">
                  <Calendar size={14} />
                  <span>{new Date(c.startTime).toLocaleDateString()}</span>
                </div>
                <div className="contest-meta-item">
                  <Clock size={14} />
                  <span>
                    {new Date(c.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({formatDuration(c.startTime, c.endTime)})
                  </span>
                </div>
                <div className="contest-meta-item">
                  <Users size={14} />
                  <span>{c.participantsCount} Registered</span>
                </div>
              </div>

              <div className="contest-card-footer">
                <span className="contest-problems-count">
                  {c.problemsCount} {c.problemsCount === 1 ? 'Problem' : 'Problems'}
                </span>

                <div className="contest-actions">
                  {c.status === 'Live' ? (
                    <button
                      onClick={() => handleJoinContest(c._id)}
                      disabled={joiningId === c._id}
                      className="btn btn-primary btn-sm"
                    >
                      <span>Enter Arena</span>
                      <ChevronRight size={15} />
                    </button>
                  ) : c.status === 'Upcoming' ? (
                    <button
                      onClick={() => handleJoinContest(c._id)}
                      disabled={joiningId === c._id}
                      className="btn btn-secondary btn-sm"
                    >
                      <CheckCircle size={14} />
                      <span>Register</span>
                    </button>
                  ) : (
                    <Link to={`/contests/${c._id}`} className="btn btn-ghost btn-sm">
                      <span>View Leaderboard</span>
                      <ChevronRight size={15} />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
