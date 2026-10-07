const mongoose = require('mongoose');

const contestProblemSchema = new mongoose.Schema(
  {
    problemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Problem',
      required: true,
    },
    points: {
      type: Number,
      required: true,
      default: 100,
    },
  },
  { _id: false }
);

const contestSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Contest name is required'],
      trim: true,
    },
    startTime: {
      type: Date,
      required: [true, 'Start time is required'],
    },
    endTime: {
      type: Date,
      required: [true, 'End time is required'],
    },
    problems: {
      type: [contestProblemSchema],
      default: [],
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

contestSchema.index({ startTime: 1, endTime: 1 });

const Contest = mongoose.model('Contest', contestSchema);

module.exports = Contest;
