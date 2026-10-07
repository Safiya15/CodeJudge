import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { Trophy, Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

export const CreateContest = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [availableProblems, setAvailableProblems] = useState([]);
  const [selectedProblems, setSelectedProblems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fetchProbs = async () => {
      try {
        const res = await api.getProblems({ limit: 50 });
        setAvailableProblems(res.data.problems);
        if (res.data.problems.length > 0) {
          setSelectedProblems([{ problemId: res.data.problems[0]._id, points: 100 }]);
        }
      } catch (err) {
        console.warn('Failed to load problems for contest builder:', err.message);
      }
    };
    fetchProbs();
  }, []);

  const handleAddProblem = () => {
    if (availableProblems.length > 0) {
      setSelectedProblems([...selectedProblems, { problemId: availableProblems[0]._id, points: 100 }]);
    }
  };

  const handleRemoveProblem = (idx) => {
    setSelectedProblems(selectedProblems.filter((_, i) => i !== idx));
  };

  const handleProblemChange = (idx, field, val) => {
    const updated = [...selectedProblems];
    updated[idx][field] = val;
    setSelectedProblems(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAdmin) {
      setError('Only administrators can schedule contests.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = {
        name,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        problems: selectedProblems,
      };

      const res = await api.createContest(payload);
      setSuccess(true);
      setTimeout(() => {
        navigate(`/contests/${res.data.contest._id}`);
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to create contest.');
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="container page-content">
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>Access Denied: Only administrators can schedule contests.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container page-content">
      <div className="page-header">
        <h1 className="page-title flex-center gap-2">
          <Trophy className="brand-icon" size={26} />
          <span>Schedule New Contest</span>
        </h1>
        <p className="page-subtitle">Configure contest start/end time, scoring points, and problem set.</p>
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <CheckCircle2 size={18} />
          <span>Contest created successfully! Redirecting...</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="card">
        <div className="form-group mb-4">
          <label>Contest Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ACM ICPC Collegiate Qualifier 2026"
            className="input-field"
          />
        </div>

        <div className="form-grid mb-4">
          <div className="form-group">
            <label>Start Time (Local)</label>
            <input
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="form-group">
            <label>End Time (Local)</label>
            <input
              type="datetime-local"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="input-field"
            />
          </div>
        </div>

        <div className="section-header mt-6">
          <h3>Contest Problem Set</h3>
          <button type="button" onClick={handleAddProblem} className="btn btn-secondary btn-sm">
            <Plus size={15} /> Add Problem
          </button>
        </div>

        <div className="contest-problem-list mt-3">
          {selectedProblems.map((sp, idx) => (
            <div key={idx} className="contest-problem-row">
              <span className="font-mono font-bold">#{idx + 1}</span>
              <div className="form-group flex-1">
                <select
                  value={sp.problemId}
                  onChange={(e) => handleProblemChange(idx, 'problemId', e.target.value)}
                  className="input-field"
                >
                  {availableProblems.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.title} ({p.difficulty?.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ width: '120px' }}>
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={sp.points}
                  onChange={(e) => handleProblemChange(idx, 'points', e.target.value)}
                  placeholder="Points"
                  className="input-field"
                />
              </div>

              {selectedProblems.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveProblem(idx)}
                  className="btn-icon-danger"
                  title="Remove"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary mt-6">
          {loading ? 'Creating Contest...' : 'Publish Contest'}
        </button>
      </form>
    </div>
  );
};
