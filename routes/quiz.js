const express = require('express');
const crypto = require('crypto');
const Quiz = require('../models/Quiz');
const QuizShare = require('../models/QuizShare');
const Student = require('../models/Student');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Services
const emailService = require('../services/emailService');
const excelService = require('../services/excelService');

// Get all quizzes
router.get('/all', protect, async (req, res) => {
  try {
    const quizzes = await Quiz.find({ userId: req.user._id })
      .populate('folderId')
      .sort('-createdAt');
    res.json(quizzes);
  } catch (error) {
    console.error('GET /quiz/all error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get quiz by id
router.get('/:id', protect, async (req, res) => {
  try {
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('folderId');

    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    res.json(quiz);
  } catch (error) {
    console.error('GET /quiz/:id error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Save quiz
router.post('/save', protect, async (req, res) => {
  try {
    const quiz = await Quiz.create({
      ...req.body,
      userId: req.user._id
    });
    res.status(201).json({ success: true, quizId: quiz._id, quiz });
  } catch (error) {
    console.error('POST /quiz/save error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update quiz
router.put('/:id', protect, async (req, res) => {
  try {
    const quiz = await Quiz.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    res.json({ success: true, quiz });
  } catch (error) {
    console.error('PUT /quiz/:id error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete quiz
router.delete('/:id', protect, async (req, res) => {
  try {
    const quiz = await Quiz.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    res.json({ success: true, message: 'Quiz deleted' });
  } catch (error) {
    console.error('DELETE /quiz/:id error:', error);
    res.status(400).json({ message: error.message });
  }
});

/*
  Share quiz:
  Accepts: { quizId, recipients?: string[], studentEmails?: string[], message?, expiresInHours? }
  If recipients/studentEmails missing -> fetch all students for teacher automatically.
  Returns: { success, links: [{email, link, status, shareId}], failed: [...] }
*/
router.post('/share', protect, async (req, res) => {
  try {
    console.log('[share] incoming body:', req.body);

    let { quizId, recipients, studentEmails, message, expiresInHours } = req.body;

    // Normalize single-string fields to array
    if (typeof studentEmails === 'string') {
      studentEmails = studentEmails.includes(',') ? studentEmails.split(',').map(s=>s.trim()) : [studentEmails.trim()];
    }
    if (typeof recipients === 'string') {
      recipients = recipients.includes(',') ? recipients.split(',').map(s=>s.trim()) : [recipients.trim()];
    }

    if (!Array.isArray(recipients) && Array.isArray(studentEmails)) {
      recipients = studentEmails;
    }

    // If no recipients, fetch students for teacher
    if (!Array.isArray(recipients) || recipients.length === 0) {
      const students = await Student.find({ userId: req.user._id }).select('email');
      recipients = (students || []).map(s => s.email).filter(Boolean);
      console.log(`[share] fetched ${recipients.length} recipients for teacher ${req.user._id}`);
    }

    if (!quizId) {
      return res.status(400).json({ message: 'quizId is required' });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ message: 'No recipients found (empty recipients and no students in DB)' });
    }

    const quiz = await Quiz.findOne({ _id: quizId, userId: req.user._id });
    if (!quiz) return res.status(404).json({ message: 'Quiz not found or you do not own it' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Normalize and prefer CLIENT_URL, fallback to FRONTEND_URL or localhost:3000
    const clientBase = (process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const results = [];
    const failed = [];

    const expiresAt = expiresInHours ? new Date(Date.now() + Number(expiresInHours) * 3600 * 1000) : null;

    // dedupe + lowercase
    const uniqueRecipients = Array.from(new Set(recipients.map(r => String(r).trim().toLowerCase()).filter(Boolean)));

    for (const email of uniqueRecipients) {
      if (!emailRegex.test(email)) {
        failed.push({ email, reason: 'Invalid email format' });
        continue;
      }

      try {
        // generate secure token
        const token = crypto.randomBytes(20).toString('hex');

        // persist share record
        const shareDoc = await QuizShare.create({
          quizId: quiz._id,
          teacherId: req.user._id,
          email,
          token,
          expiresAt,
          status: 'pending'
        });

        // IMPORTANT: link uses token in path for student page
        // Use the frontend route that the React app expects: /quiz/attempt/:token
        const uniqueLink = `${clientBase}/quiz/attempt/${token}`;

        // send email
        await emailService.sendQuizInvitation(
          email,
          quiz.title,
          uniqueLink,
          req.user.name,
          message || ''
        );

        // update share record
        shareDoc.status = 'sent';
        shareDoc.sentAt = new Date();
        await shareDoc.save();

        results.push({ email, link: uniqueLink, status: 'sent', shareId: shareDoc._id });
      } catch (err) {
        console.error(`Failed to create/send for ${email}:`, err);
        failed.push({ email, reason: err.message || 'save/send failed' });
      }
    }

    return res.json({
      success: true,
      message: `Processed ${results.length} recipients`,
      links: results,
      failed
    });
  } catch (error) {
    console.error('POST /quiz/share error:', error);
    return res.status(400).json({ message: error.message || 'Failed to share quiz' });
  }
});

// validate token (optional - we use studentQuiz routes, but keep for compatibility)
router.get('/:id/validate-token', async (req, res) => {
  try {
    const { token } = req.query;
    const quizId = req.params.id;

    if (!token) return res.status(400).json({ message: 'token required' });

    const share = await QuizShare.findOne({ quizId, token });
    if (!share) return res.status(403).json({ message: 'Invalid or revoked token' });

    if (share.expiresAt && share.expiresAt < new Date()) {
      share.status = 'expired';
      await share.save();
      return res.status(403).json({ message: 'Link has expired' });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    res.json({
      success: true,
      quiz,
      email: share.email,
      shareId: share._id
    });
  } catch (error) {
    console.error('GET /quiz/:id/validate-token error:', error);
    res.status(400).json({ message: error.message || 'Token validation failed' });
  }
});

// results and download endpoints (unchanged)
router.get('/:id/results', protect, async (req, res) => {
  try {
    const QuizAttempt = require('../models/QuizAttempt');

    const quiz = await Quiz.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    const attempts = await QuizAttempt.find({
      quizId: req.params.id,
      teacherId: req.user._id
    }).sort('-submittedAt');

    res.json({
      success: true,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        numQuestions: quiz.questions.length
      },
      attempts
    });
  } catch (error) {
    console.error('GET /quiz/:id/results error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.get('/:id/results/download', protect, async (req, res) => {
  try {
    const QuizAttempt = require('../models/QuizAttempt');

    const quiz = await Quiz.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    const attempts = await QuizAttempt.find({
      quizId: req.params.id,
      teacherId: req.user._id,
      status: { $in: ['submitted', 'graded'] }
    }).sort('-submittedAt');

    if (attempts.length === 0) {
      return res.status(404).json({ message: 'No quiz attempts found' });
    }

    const detailed = req.query.detailed === 'true';
    const excelBuffer = detailed
      ? excelService.generateDetailedQuizResultsExcel(quiz.title, quiz, attempts)
      : excelService.generateQuizResultsExcel(quiz.title, attempts);

    const filename = `${quiz.title.replace(/[^a-z0-9]/gi, '_')}_results_${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);
  } catch (error) {
    console.error('GET /quiz/:id/results/download error:', error);
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;