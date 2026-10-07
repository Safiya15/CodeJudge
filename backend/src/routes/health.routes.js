const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

/**
 * @route   GET /health
 * @desc    Liveness & readiness probe check
 * @access  Public
 */
router.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbStatus,
    },
  });
});

module.exports = router;
