import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Search, Clock, Cpu, Filter, AlertCircle } from 'lucide-react';

export const ProblemList = () => {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [difficulty, setDifficulty] = useState('');
  const [search, setSearch] = useState('');

  const fetchProblems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getProblems({ difficulty, search });
      setProblems(res.data.problems);
    } catch (err) {
      setError(err.message || 'Failed to load problems');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProblems();
  }, [difficulty]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchProblems();
  };

  const getDifficultyBadge = (diff) => {
    const cls = {
      easy: 'badge-easy',
      medium: 'badge-medium',
      hard: 'badge-hard',
    }[diff?.toLowerCase()] || 'badge-neutral';

    return <span className={`difficulty-badge ${cls}`}>{diff ? diff.toUpperCase() : 'UNKNOWN'}</span>;
  };

  return (
    <div className="container page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Problem Repository</h1>
          <p className="page-subtitle">Practice algorithmic challenges and prepare for contests.</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-bar">
        <form onSubmit={handleSearchSubmit} className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search problems by title or tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-search"
          />
        </form>

        <div className="difficulty-tabs">
          {['', 'easy', 'medium', 'hard'].map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={`tab-btn ${difficulty === d ? 'active' : ''}`}
            >
              {d === '' ? 'All Difficulties' : d.charAt(0).toUpperCase() + d.slice(1)}
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

      {/* Problem Table / Cards */}
      {loading ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading problems...</p>
        </div>
      ) : problems.length === 0 ? (
        <div className="empty-state">
          <Filter size={48} className="empty-icon" />
          <h3>No problems found</h3>
          <p>Try modifying your search or difficulty filter.</p>
        </div>
      ) : (
        <div className="problems-table-wrapper">
          <table className="problems-table">
            <thead>
              <tr>
                <th style={{ width: '45%' }}>Title</th>
                <th style={{ width: '15%' }}>Difficulty</th>
                <th style={{ width: '25%' }}>Tags</th>
                <th style={{ width: '15%' }}>Constraints</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((prob) => (
                <tr key={prob._id}>
                  <td>
                    <Link to={`/problems/${prob.slug}`} className="problem-title-link">
                      {prob.title}
                    </Link>
                  </td>
                  <td>{getDifficultyBadge(prob.difficulty)}</td>
                  <td>
                    <div className="tag-list">
                      {prob.tags && prob.tags.length > 0 ? (
                        prob.tags.map((t) => (
                          <span key={t} className="tag-chip">
                            {t}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted text-sm">—</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="constraints-cell text-sm text-muted">
                      <span title="Time Limit">
                        <Clock size={13} /> {(prob.timeLimitMs / 1000).toFixed(1)}s
                      </span>
                      <span title="Memory Limit">
                        <Cpu size={13} /> {prob.memoryLimitMb}MB
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
