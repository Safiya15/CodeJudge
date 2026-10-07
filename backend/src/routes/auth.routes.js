const express = require('express');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

/**
 * @route   POST /auth/register
 * @desc    Register a new user (student or admin)
 * @access  Public
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    // Validate presence
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name, email, and password.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'An account with this email address already exists.',
      });
    }

    // Hash password with bcrypt (10 rounds)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Validate role if specified
    const assignedRole = role && ['student', 'admin'].includes(role) ? role : 'student';

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: assignedRole,
    });

    const token = user.generateAuthToken();

    res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      data: {
        user: user.toJSON(),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /auth/login
 * @desc    Authenticate user & return JWT token (Rate limited: 5 per IP / min)
 * @access  Public
 */
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both email and password.',
      });
    }

    // Find user by lowercase email
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    // Verify password hash
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const token = user.generateAuthToken();

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        user: user.toJSON(),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /auth/me
 * @desc    Get currently authenticated user profile
 * @access  Private (Authenticated)
 */
router.get('/me', requireAuth, async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: req.user,
    },
  });
});

/**
 * @route   GET /auth/admin-check
 * @desc    Verify admin role authorization
 * @access  Private (Admin only)
 */
router.get('/admin-check', requireAuth, requireRole('admin'), async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Access granted: you have administrator privileges.',
    data: {
      user: req.user,
    },
  });
});

module.exports = router;
