// backend/models/QuizAttempt.js
const mongoose = require('mongoose');

const quizAttemptSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // student info captured at start
  studentName: { type: String, required: true, trim: true },
  studentUSN: { type: String, required: true, trim: true, uppercase: true },
  studentEmail: { type: String, required: true, trim: true, lowercase: true },
  studentBranch: { type: String, required: true, trim: true },
  studentYear: { type: String, required: true },
  studentSemester: { type: String, required: true },

  // answers array of plain strings (index corresponds to quiz.questions index)
  answers: { type: [String], default: [] },

  // results summary after submission / grading
  totalMarks: { type: Number, default: 0 },
  maxMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  perQuestion: [
    {
      questionIndex: Number,
      correct: Boolean,
      awarded: Number,
      max: Number,
      expectedAnswer: String,
      givenAnswer: String,
      explanation: String
    }
  ],

  status: {
    type: String,
    enum: ['in-progress', 'submitted', 'graded', 'abandoned'],
    default: 'in-progress'
  },

  startedAt: { type: Date, default: Date.now },
  submittedAt: Date,
  gradedAt: Date,

  // token used in share link (unique per share)
  uniqueToken: { type: String, required: true, unique: true }
}, {
  timestamps: true
});

// Useful indexes
quizAttemptSchema.index({ teacherId: 1, quizId: 1 });
quizAttemptSchema.index({ uniqueToken: 1 });
quizAttemptSchema.index({ studentEmail: 1, quizId: 1 });

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);