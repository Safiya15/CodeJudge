const client = require('prom-client');

// Create a dedicated Prometheus registry for CodeJudge
const register = new client.Registry();

// Collect standard Node.js runtime and process metrics (CPU, Memory, Event Loop)
client.collectDefaultMetrics({ register, prefix: 'codejudge_' });

// 1. API HTTP Request Duration Histogram
const httpRequestDurationSeconds = new client.Histogram({
  name: 'codejudge_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// 2. API HTTP Requests Total Counter
const httpRequestsTotal = new client.Counter({
  name: 'codejudge_http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// 3. API HTTP Errors Total Counter (4xx, 5xx)
const httpErrorsTotal = new client.Counter({
  name: 'codejudge_http_errors_total',
  help: 'Total number of HTTP error responses (HTTP status >= 400)',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// 4. Submissions Total Counter
const submissionsTotal = new client.Counter({
  name: 'codejudge_submissions_total',
  help: 'Total number of code submissions received',
  labelNames: ['language', 'contest'],
  registers: [register],
});

// 5. Verdict Total Counter
const verdictTotal = new client.Counter({
  name: 'codejudge_verdict_total',
  help: 'Total number of verdicts rendered by verdict type and language',
  labelNames: ['verdict', 'language'],
  registers: [register],
});

// 6. Judge Execution Duration Histogram
const judgeDurationSeconds = new client.Histogram({
  name: 'codejudge_judge_duration_seconds',
  help: 'Execution duration of sandboxed code judging in seconds',
  labelNames: ['language', 'verdict'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30],
  registers: [register],
});

// 7. Judge Queue Depth Gauge
const queueDepth = new client.Gauge({
  name: 'codejudge_queue_depth',
  help: 'Current depth of the judge job queue by state',
  labelNames: ['state'], // 'waiting', 'active', 'delayed'
  registers: [register],
});

/**
 * Normalizes HTTP route path to prevent high-cardinality metrics explosion
 */
const normalizeRoute = (req) => {
  if (req.route && req.route.path) {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}`;
  }
  // Fallback for paths that didn't match a registered route (e.g. 404s)
  const segments = req.path.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  return `/${segments[0]}`;
};

/**
 * Express middleware to record HTTP metrics
 */
const metricsMiddleware = (req, res, next) => {
  // Do not track Prometheus scraping requests to avoid self-referential metrics
  if (req.path === '/metrics') {
    return next();
  }

  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    const route = normalizeRoute(req);
    const statusCode = res.statusCode.toString();

    httpRequestDurationSeconds.observe(
      { method: req.method, route, status_code: statusCode },
      durationInSeconds
    );

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: statusCode,
    });

    if (res.statusCode >= 400) {
      httpErrorsTotal.inc({
        method: req.method,
        route,
        status_code: statusCode,
      });
    }
  });

  next();
};

module.exports = {
  register,
  httpRequestDurationSeconds,
  httpRequestsTotal,
  httpErrorsTotal,
  submissionsTotal,
  verdictTotal,
  judgeDurationSeconds,
  queueDepth,
  metricsMiddleware,
};
