// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const serverless = require('serverless-http');

// Routes
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quiz');
const folderRoutes = require('./routes/folder');
const bookmarkRoutes = require('./routes/bookmark');
const studentRoutes = require('./routes/student');
const studentQuizRoutes = require('./routes/studentQuiz');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { createIndexes } = require('./config/dbIndexes');

const app = express();

// ---- CONFIG ----
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1);

// ---- CORS ----
const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  "https://frontend-smartai-hydx.vercel.app",
  "http://localhost:5173",
  "http://localhost:8080"
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn("CORS BLOCKED:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ----- Parsing -----
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- MongoDB ----
const MONGO_URI = process.env.MONGODB_URI;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!global._connPromise) {
    global._connPromise = mongoose.connect(MONGO_URI).then(async () => {
      console.log("MongoDB Connected.");
      if (createIndexes) await createIndexes();
    });
  }
  await global._connPromise;
}

app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// ---- ROUTES ----
app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/student-quiz', studentQuizRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "OK" });
});

// ---- ERRORS ----
app.use(notFound);
app.use(errorHandler);

// ---- LOCAL DEV MODE ----
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Local server running on port ${PORT}`);
    console.log("Allowed origins:", allowedOrigins);
  });
}

// ---- VERCEL EXPORT ----
module.exports = serverless(app);
