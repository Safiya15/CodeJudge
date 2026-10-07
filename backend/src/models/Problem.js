const mongoose = require('mongoose');

const problemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Problem title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      required: [true, 'Problem slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    statement: {
      type: String,
      required: [true, 'Problem statement (markdown) is required'],
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    },
    tags: {
      type: [String],
      default: [],
    },
    timeLimitMs: {
      type: Number,
      required: true,
      default: 2000, // 2 seconds default
      min: [100, 'Time limit must be at least 100ms'],
      max: [10000, 'Time limit cannot exceed 10000ms'],
    },
    memoryLimitMb: {
      type: Number,
      required: true,
      default: 256, // 256 MB default
      min: [16, 'Memory limit must be at least 16MB'],
      max: [1024, 'Memory limit cannot exceed 1024MB'],
    },
    allowedLanguages: {
      type: [String],
      default: ['cpp', 'python', 'java', 'javascript'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);


const Problem = mongoose.model('Problem', problemSchema);

module.exports = Problem;
