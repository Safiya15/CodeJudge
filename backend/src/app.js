const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const problemRoutes = require('./routes/problem.routes');
const contestRoutes = require('./routes/contest.routes');
const runRoutes = require('./routes/run.routes');
const submissionRoutes = require('./routes/submission.routes');
const healthRoutes = require('./routes/health.routes');
const metricsRoutes = require('./routes/metrics.routes');
const { metricsMiddleware } = require('./services/metrics.service');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// Prometheus Metrics Middleware (observes HTTP duration, status codes, request counts)
app.use(metricsMiddleware);

// Security HTTP headers
app.use(helmet());

// Cross-Origin Resource Sharing configuration
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(new Error('Blocked by CORS policy'));
    },
    credentials: true,
  })
);

// Cap request body size to 1MB to prevent large payload Denial-of-Service
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging (skip in test environment to keep test logs clean)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Mount Routes
app.use('/', healthRoutes);
app.use('/', metricsRoutes);
app.use('/', runRoutes);
app.use('/', submissionRoutes);
app.use('/auth', authRoutes);
app.use('/problems', problemRoutes);
app.use('/contests', contestRoutes);

// Fallback handlers
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
