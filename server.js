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

/**
 * Normalize allowlist entries so they match the browser Origin header
 * - If entry already includes http(s)://, keep it
 * - Otherwise assume https://host
 * - Trim trailing slashes
 */
function normalizeOriginEntry(entry) {
  if (!entry) return null;
  entry = String(entry).trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(entry)) return entry;
  return `https://${entry}`;
}

// Raw allowlist (edit as needed). Keep env entries; they'll be normalized.
const rawAllowlist = [
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
  'https://frontend-smartai-hydx.vercel.app',
  'https://smartai-ten.vercel.app',
  process.env.CLIENT_URL,      // e.g. https://your-frontend.example.com or bare host
  process.env.VERCEL_URL       // often a bare host like frontend-xyz.vercel.app
];

// Optionally allow all vercel preview subdomains (UNSECURE: enable only if acceptable).
// Set ALLOW_VERCEL_PREVIEWS=true in env to permit https://*.vercel.app origins.
const allowVercelPreviews = String(process.env.ALLOW_VERCEL_PREVIEWS || '').toLowerCase() === 'true';

const allowedOrigins = Array.from(new Set(
  rawAllowlist
    .map(normalizeOriginEntry)
    .filter(Boolean)
));

// For visibility in logs
console.log('Initial normalized allowed origins:', allowedOrigins);
console.log('ALLOW_VERCEL_PREVIEWS:', allowVercelPreviews);

// --- Small incoming-origin logger (placed BEFORE CORS so preflight origin is visible) ---
app.use((req, res, next) => {
  // This helps debug what the browser actually sends as the Origin header.
  console.log(new Date().toISOString(), '- Incoming Origin header:', req.headers.origin);
  next();
});

// Use cors package with a dynamic origin function
const corsOptions = {
  origin: function (origin, callback) {
    // Allow non-browser clients (curl, server-to-server) where origin is undefined
    if (!origin) return callback(null, true);

    // exact match allowed
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // optional: allow vercel preview subdomains like https://something.vercel.app
    if (allowVercelPreviews && /^https:\/\/.+\.vercel\.app$/i.test(origin)) {
      console.log('Allowing vercel preview origin:', origin);
      return callback(null, true);
    }

    // blocked
    console.warn('Blocked CORS request from origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

// Apply CORS before body parsers and routes so preflight is handled
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // enable preflight across the board

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
      'GET /api/auth',
      'GET /api/bookmark',
      'GET /api/quiz',
      'GET /api/folders',
      'GET /api/students',
      'GET /api/students-quiz',
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
  console.log(`Allowed client origins (explicit list):`, allowedOrigins);
  if (allowVercelPreviews) {
    console.log('Vercel preview wildcard is ENABLED (https://*.vercel.app allowed).');
  }
});
