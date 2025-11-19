// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const path = require('path');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quiz');
const folderRoutes = require('./routes/folder');
const bookmarkRoutes = require('./routes/bookmark');
const studentRoutes = require('./routes/student');
const studentQuizRoutes = require('./routes/studentQuiz');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { createIndexes } = require('./config/dbIndexes');

const app = express();

// --- Config ---
const PORT = process.env.PORT || 3001;

// allowed origins: include your local dev and production frontend (Vercel) URLs
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
  'https://frontend-smartai-hydx.vercel.app', // ← ADD THIS
  'https://smartai-ten.vercel.app', // ← AND THIS (your other frontend)
  process.env.CLIENT_URL,
  process.env.VERCEL_URL
].filter(Boolean);

// Use cors package (echo origin when allowed)
const corsOptions = {
  origin: function (origin, callback) {
    // allow non-browser clients (curl/postman) where origin is undefined
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn('Blocked CORS request from origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization, X-Requested-With'
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// parse JSON and cookies
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- Request logging middleware ---
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// --- Root route ---
app.get('/', (req, res) => {
  res.json({ 
    message: 'SmartAI Backend API is running!', 
    version: '1.0',
    endpoints: [
      'GET /api/health',
      'GET /api/debug/test-nodemailer',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/quiz',
      'GET /api/folders',
      'GET /api/students',
    ],
    timestamp: new Date().toISOString()
  });
});

// --- MongoDB connect (env: MONGODB_URI) ---
// Cache connection in serverless / repeated starts
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/quizapp';
async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (global._mongoPromise) await global._mongoPromise;
  else {
    global._mongoPromise = mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
      .then(async () => {
        console.log('MongoDB connected successfully');
        if (typeof createIndexes === 'function') {
          try {
            await createIndexes();
            console.log('DB indexes created');
          } catch (err) {
            console.error('Error creating DB indexes:', err);
          }
        }
      })
      .catch((err) => {
        console.error('MongoDB connection error:', err);
        throw err;
      });
    await global._mongoPromise;
  }
}

// ensure DB connected before handling routes
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/student-quiz', studentQuizRoutes);

// health
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// --- Email debug route (safe require) ---
let emailService = null;
try {
  emailService = require('./services/emailService');
  console.log('Email service module loaded');
} catch (e) {
  console.warn('Email service module not found or failed to load:', e.message || e);
}

app.get('/api/debug/test-nodemailer', async (req, res) => {
  try {
    if (!emailService || typeof emailService.verifyConnection !== 'function') {
      return res.status(500).json({ ok: false, error: 'Email service not configured or verifyConnection missing' });
    }
    const ok = await emailService.verifyConnection();
    return res.json({ ok });
  } catch (err) {
    console.error('/api/debug/test-nodemailer error', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// error handlers (keep these last)
app.use(notFound);
app.use(errorHandler);

// start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Allowed client origins:`, allowedOrigins);
});