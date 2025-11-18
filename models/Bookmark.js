const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder'
  },
  question: {
    id: String,
    type: {
      type: String,
      enum: ['mcq', 'short-answer', 'mixed'],
      required: true
    },
    question: {
      type: String,
      required: true
    },
    options: [String],
    answer: String,
    explanation: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Bookmark', bookmarkSchema);
