// backend/models/QuizShare.js
const mongoose = require('mongoose');

const quizShareSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'taken', 'expired'],
    default: 'pending',
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('QuizShare', quizShareSchema);
