const mongoose = require('mongoose');

const testCaseSchema = new mongoose.Schema(
  {
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Problem',
      required: true,
      index: true,
    },
    input: {
      type: String,
      default: '',
    },
    expectedOutput: {
      type: String,
      required: [true, 'Expected output is required'],
    },
    isHidden: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index on problemId and order for sequential test execution
testCaseSchema.index({ problemId: 1, order: 1 });

const TestCase = mongoose.model('TestCase', testCaseSchema);

module.exports = TestCase;
