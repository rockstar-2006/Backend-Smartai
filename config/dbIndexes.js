// config/dbIndexes.js
const User = require('../models/User');
const Quiz = require('../models/Quiz');
const Student = require('../models/Student');
const Bookmark = require('../models/Bookmark');
const Folder = require('../models/Folder');

async function ensureIndex(collection, indexSpec, options = {}) {
  const existing = await collection.indexes(); // list existing indexes
  const indexExists = existing.some(idx => {
    // compare key specs as JSON strings (simple robust check)
    return JSON.stringify(idx.key) === JSON.stringify(indexSpec);
  });
  if (!indexExists) {
    await collection.createIndex(indexSpec, options);
    console.log(`Created index on ${collection.collectionName}:`, indexSpec);
  } else {
    console.log(`Index already exists on ${collection.collectionName}:`, indexSpec);
  }
}

exports.createIndexes = async () => {
  try {
    // User indexes
    await ensureIndex(User.collection, { email: 1 }, { unique: true });

    // Quiz indexes - optimize queries by userId
    await ensureIndex(Quiz.collection, { userId: 1, createdAt: -1 });
    await ensureIndex(Quiz.collection, { userId: 1, folderId: 1 });

    // Student indexes
    await ensureIndex(Student.collection, { userId: 1, createdAt: -1 });
    await ensureIndex(Student.collection, { userId: 1, email: 1 });
    await ensureIndex(Student.collection, { userId: 1, usn: 1 });

    // Bookmark indexes
    await ensureIndex(Bookmark.collection, { userId: 1, createdAt: -1 });
    await ensureIndex(Bookmark.collection, { userId: 1, folderId: 1 });

    // Folder indexes
    await ensureIndex(Folder.collection, { userId: 1, createdAt: -1 });

    console.log('Database indexes ensured successfully');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
};
