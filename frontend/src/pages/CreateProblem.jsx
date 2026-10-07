import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

export const CreateProblem = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [tags, setTags] = useState('array, algorithms');
  const [timeLimitMs, setTimeLimitMs] = useState(2000);
  const [memoryLimitMb, setMemoryLimitMb] = useState(256);
  const [statement, setStatement] = useState(
    '### Problem Statement\n\nDescribe the problem here...\n\n### Input Format\n\n### Output Format'
  );

  const [testCases, setTestCases] = useState([
    { input: '', expectedOutput: '', isHidden: false },
    { input: '', expectedOutput: '', isHidden: true },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleAddTestCase = () => {
    setTestCases([...testCases, { input: '', expectedOutput: '', isHidden: true }]);
  };

  const handleRemoveTestCase = (index) => {
    setTestCases(testCases.filter((_, i) => i !== index));
  };

  const handleTestCaseChange = (index, field, value) => {
    const updated = [...testCases];
    updated[index][field] = value;
    setTestCases(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAdmin) {
      setError('Only administrators can create problems.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = {
        title,
        slug: slug.trim() || undefined,
        difficulty,
        tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        timeLimitMs: Number(timeLimitMs),
        memoryLimitMb: Number(memoryLimitMb),
        statement,
        testCases: testCases.filter((tc) => tc.expectedOutput.trim() !== ''),
      };

      const res = await api.createProblem(payload);
      setSuccess(true);
      setTimeout(() => {
        navigate(`/problems/${res.data.problem.slug}`);
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to create problem.');
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="container page-content">
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>Access Denied: Only administrators can access this page.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container page-content">
      <div className="page-header">
        <h1 className="page-title">Create New Problem</h1>
        <p className="page-subtitle">Define problem statement, limits, and test cases.</p>
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
          <span>Problem created successfully! Redirecting...</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="problem-form card">
        <div className="form-grid">
          <div className="form-group">
            <label>Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Invert Binary Tree"
              className="input-field"
            />
          </div>

          <div className="form-group">
            <label>Slug (optional)</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-generated if empty"
              className="input-field"
            />
          </div>

          <div className="form-group">
            <label>Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="input-field"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div className="form-group">
            <label>Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tree, recursion, dfs"
              className="input-field"
            />
          </div>

          <div className="form-group">
            <label>Time Limit (ms)</label>
            <input
              type="number"
              value={timeLimitMs}
              onChange={(e) => setTimeLimitMs(e.target.value)}
              min={100}
              max={10000}
              className="input-field"
            />
          </div>

          <div className="form-group">
            <label>Memory Limit (MB)</label>
            <input
              type="number"
              value={memoryLimitMb}
              onChange={(e) => setMemoryLimitMb(e.target.value)}
              min={16}
              max={1024}
              className="input-field"
            />
          </div>
        </div>

        <div className="form-group mt-4">
          <label>Problem Statement (Markdown supported)</label>
          <textarea
            required
            rows={8}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            className="input-field textarea"
          />
        </div>

        <div className="testcases-builder mt-6">
          <div className="section-header">
            <h3>Test Cases</h3>
            <button type="button" onClick={handleAddTestCase} className="btn btn-secondary btn-sm">
              <Plus size={16} /> Add Test Case
            </button>
          </div>

          {testCases.map((tc, idx) => (
            <div key={idx} className="tc-builder-card">
              <div className="tc-builder-header">
                <span>Test Case #{idx + 1}</span>
                <div className="tc-builder-actions">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={tc.isHidden}
                      onChange={(e) => handleTestCaseChange(idx, 'isHidden', e.target.checked)}
                    />
                    <span>Hidden Test Case</span>
                  </label>
                  {testCases.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveTestCase(idx)}
                      className="btn-icon-danger"
                      title="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
              <div className="tc-inputs-row">
                <div className="form-group">
                  <label className="text-xs">Standard Input (stdin)</label>
                  <textarea
                    rows={2}
                    value={tc.input}
                    onChange={(e) => handleTestCaseChange(idx, 'input', e.target.value)}
                    placeholder="Input passed to stdin"
                    className="input-field"
                  />
                </div>
                <div className="form-group">
                  <label className="text-xs">Expected Output (stdout)</label>
                  <textarea
                    rows={2}
                    required
                    value={tc.expectedOutput}
                    onChange={(e) => handleTestCaseChange(idx, 'expectedOutput', e.target.value)}
                    placeholder="Expected stdout string"
                    className="input-field"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary mt-6">
          {loading ? 'Publishing Problem...' : 'Publish Problem'}
        </button>
      </form>
    </div>
  );
};
