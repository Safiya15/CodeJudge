const express = require('express');
const { register, queueDepth } = require('../services/metrics.service');
const { getQueueCounts } = require('../queue/judgeQueue');

const router = express.Router();

/**
 * @route   GET /metrics
 * @desc    Prometheus metrics exposition endpoint
 * @access  Public (Scraped by Prometheus server)
 */
router.get('/metrics', async (req, res, next) => {
  try {
    // Update queue depth gauge before Prometheus gathers metrics
    const counts = await getQueueCounts();
    queueDepth.set({ state: 'waiting' }, counts.waiting || 0);
    queueDepth.set({ state: 'active' }, counts.active || 0);
    queueDepth.set({ state: 'delayed' }, counts.delayed || 0);

    res.setHeader('Content-Type', register.contentType);
    const metricsOutput = await register.metrics();
    res.status(200).send(metricsOutput);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
