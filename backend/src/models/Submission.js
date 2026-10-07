const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Problem',
      required: true,
    },
    contestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contest',
      default: null,
    },
    language: {
      type: String,
      required: [true, 'Language is required'],
      enum: ['cpp', 'python', 'java', 'javascript'],
    },
    code: {
      type: String,
      required: [true, 'Code is required'],
    },
    status: {
      type: String,
      enum: ['Pending', 'Processing', 'Completed', 'Failed'],
      default: 'Pending',
    },
    verdict: {
      type: String,
      enum: [
        'Accepted',
        'Wrong Answer',
        'Time Limit Exceeded',
        'Memory Limit Exceeded',
        'Runtime Error',
        'Compilation Error',
        null,
      ],
      default: null,
    },
    runtimeMs: {
      type: Number,
      default: null,
    },
    memoryKb: {
      type: Number,
      default: null,
    },
    failedTestIndex: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

// Required indexes:
// 1. (userId, problemId) for user's submissions per problem
submissionSchema.index({ userId: 1, problemId: 1 });
// 2. (contestId, createdAt) for contest chronological submission queries
submissionSchema.index({ contestId: 1, createdAt: 1 });

const Submission = mongoose.model('Submission', submissionSchema);

module.exports = Submission;
