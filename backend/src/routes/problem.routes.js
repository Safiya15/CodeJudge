const express = require('express');
const { Problem, TestCase } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Helper to slugify a string if slug is not provided
 */
const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, '-');
};

/**
 * @route   GET /problems
 * @desc    Get all problems (with filtering, search, pagination)
 * @access  Public
 */
router.get('/', async (req, res, next) => {
  try {
    const { difficulty, tag, search, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (difficulty) filter.difficulty = difficulty.toLowerCase();
    if (tag) filter.tags = tag.toLowerCase();
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [problems, total] = await Promise.all([
      Problem.find(filter)
        .select('title slug difficulty tags timeLimitMs memoryLimitMb allowedLanguages createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Problem.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        problems,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /problems/:slug
 * @desc    Get a single problem by slug with SAMPLE test cases only
 * @access  Public (Hidden test cases are NEVER exposed)
 */
router.get('/:slug', async (req, res, next) => {
  try {
    const problem = await Problem.findOne({ slug: req.params.slug }).lean();
    if (!problem) {
      return res.status(404).json({
        success: false,
        error: 'Problem not found',
      });
    }

    // Explicitly query ONLY visible/sample test cases (isHidden: false)
    const sampleTestCases = await TestCase.find({
      problemId: problem._id,
      isHidden: false,
    })
      .select('input expectedOutput order')
      .sort({ order: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        problem: {
          ...problem,
          sampleTestCases,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /problems
 * @desc    Create a new problem
 * @access  Private (Admin only)
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const {
      title,
      slug,
      statement,
      difficulty,
      tags,
      timeLimitMs,
      memoryLimitMb,
      allowedLanguages,
      testCases,
    } = req.body;

    if (!title || !statement) {
      return res.status(400).json({
        success: false,
        error: 'Problem title and statement are required.',
      });
    }

    const finalSlug = slug ? slugify(slug) : slugify(title);

    // Verify slug uniqueness
    const existingProblem = await Problem.findOne({ slug: finalSlug });
    if (existingProblem) {
      return res.status(400).json({
        success: false,
        error: `A problem with slug "${finalSlug}" already exists.`,
      });
    }

    const problem = await Problem.create({
      title: title.trim(),
      slug: finalSlug,
      statement,
      difficulty: difficulty ? difficulty.toLowerCase() : 'medium',
      tags: tags || [],
      timeLimitMs: timeLimitMs || 2000,
      memoryLimitMb: memoryLimitMb || 256,
      allowedLanguages: allowedLanguages || ['cpp', 'python', 'java', 'javascript'],
      createdBy: req.user._id,
    });

    // If initial test cases were provided in the payload, insert them
    if (Array.isArray(testCases) && testCases.length > 0) {
      const formattedCases = testCases.map((tc, index) => ({
        problemId: problem._id,
        input: tc.input || '',
        expectedOutput: tc.expectedOutput,
        isHidden: !!tc.isHidden,
        order: tc.order != null ? tc.order : index + 1,
      }));
      await TestCase.insertMany(formattedCases);
    }

    res.status(201).json({
      success: true,
      message: 'Problem created successfully.',
      data: { problem },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /problems/:id
 * @desc    Update an existing problem
 * @access  Private (Admin only)
 */
router.put('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { title, statement, difficulty, tags, timeLimitMs, memoryLimitMb, allowedLanguages } =
      req.body;

    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({
        success: false,
        error: 'Problem not found',
      });
    }

    if (title) problem.title = title.trim();
    if (statement) problem.statement = statement;
    if (difficulty) problem.difficulty = difficulty;
    if (tags) problem.tags = tags;
    if (timeLimitMs) problem.timeLimitMs = timeLimitMs;
    if (memoryLimitMb) problem.memoryLimitMb = memoryLimitMb;
    if (allowedLanguages) problem.allowedLanguages = allowedLanguages;

    await problem.save();

    res.status(200).json({
      success: true,
      message: 'Problem updated successfully.',
      data: { problem },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   DELETE /problems/:id
 * @desc    Delete problem and cascade-delete all associated test cases
 * @access  Private (Admin only)
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({
        success: false,
        error: 'Problem not found',
      });
    }

    // Cascade delete test cases
    await TestCase.deleteMany({ problemId: problem._id });
    await problem.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Problem and associated test cases deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /problems/:id/testcases
 * @desc    Add one or multiple test cases to a problem
 * @access  Private (Admin only)
 */
router.post('/:id/testcases', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({
        success: false,
        error: 'Problem not found',
      });
    }

    const { testCases } = req.body;
    const casesToAdd = Array.isArray(testCases) ? testCases : [req.body];

    if (casesToAdd.length === 0 || !casesToAdd[0].expectedOutput) {
      return res.status(400).json({
        success: false,
        error: 'At least one test case with expectedOutput is required.',
      });
    }

    const count = await TestCase.countDocuments({ problemId: problem._id });
    const formatted = casesToAdd.map((tc, idx) => ({
      problemId: problem._id,
      input: tc.input || '',
      expectedOutput: tc.expectedOutput,
      isHidden: tc.isHidden !== undefined ? tc.isHidden : false,
      order: tc.order != null ? tc.order : count + idx + 1,
    }));

    const createdCases = await TestCase.insertMany(formatted);

    res.status(201).json({
      success: true,
      message: `${createdCases.length} test case(s) added successfully.`,
      data: { testCases: createdCases },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /problems/:id/testcases
 * @desc    Get all test cases (both sample and hidden) for administration/inspection
 * @access  Private (Admin only)
 */
router.get('/:id/testcases', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({
        success: false,
        error: 'Problem not found',
      });
    }

    const testCases = await TestCase.find({ problemId: problem._id }).sort({ order: 1 });

    res.status(200).json({
      success: true,
      data: { testCases },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
