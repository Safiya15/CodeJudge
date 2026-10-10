const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const apiRequest = async (path, options = {}) => {
  const token = localStorage.getItem('codejudge_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

export const api = {
  // Auth
  register: (payload) => apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  getMe: () => apiRequest('/auth/me'),

  // Problems
  getProblems: (params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.difficulty) searchParams.append('difficulty', params.difficulty);
    if (params.tag) searchParams.append('tag', params.tag);
    if (params.search) searchParams.append('search', params.search);
    const queryString = searchParams.toString();
    return apiRequest(`/problems${queryString ? `?${queryString}` : ''}`);
  },
  getProblemBySlug: (slug) => apiRequest(`/problems/${slug}`),
  createProblem: (payload) => apiRequest('/problems', { method: 'POST', body: JSON.stringify(payload) }),

  // Submissions & Execution
  runCode: (payload) => apiRequest('/run', { method: 'POST', body: JSON.stringify(payload) }),
  submitCode: (payload) => apiRequest('/submissions', { method: 'POST', body: JSON.stringify(payload) }),
  getSubmission: (id) => apiRequest(`/submissions/${id}`),
  getSubmissions: (params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.problemId) searchParams.append('problemId', params.problemId);
    if (params.contestId) searchParams.append('contestId', params.contestId);
    if (params.mine) searchParams.append('mine', params.mine);
    const queryString = searchParams.toString();
    return apiRequest(`/submissions${queryString ? `?${queryString}` : ''}`);
  },

  // Contests & Leaderboards
  getContests: () => apiRequest('/contests'),
  getContestById: (id) => apiRequest(`/contests/${id}`),
  joinContest: (id) => apiRequest(`/contests/${id}/join`, { method: 'POST' }),
  getContestLeaderboard: (id) => apiRequest(`/contests/${id}/leaderboard`),
  createContest: (payload) => apiRequest('/contests', { method: 'POST', body: JSON.stringify(payload) }),
};
