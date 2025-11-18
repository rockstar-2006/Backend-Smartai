// backend/routes/studentQuiz.js
const express = require('express');
const Quiz = require('../models/Quiz');
const QuizShare = require('../models/QuizShare');
const QuizAttempt = require('../models/QuizAttempt');
const gradingService = require('../services/gradingService'); // optional

const router = express.Router();

/**
 * New route:
 * GET /api/student-quiz/token/:token
 * Return quiz metadata (or 404) for the token in the share record.
 */
router.get('/token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const share = await QuizShare.findOne({ token }).populate('quizId');
    if (!share) return res.status(404).json({ message: 'Share link not found or expired' });

    if (share.expiresAt && new Date() > new Date(share.expiresAt)) {
      return res.status(410).json({ message: 'Link expired' });
    }

    const quiz = share.quizId;
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    // Return safe quiz preview for student start page (no answers)
    const safeQuiz = {
      id: quiz._id,
      title: quiz.title,
      description: quiz.description,
      duration: quiz.duration,
      numQuestions: (quiz.questions && quiz.questions.length) || quiz.numQuestions || 0,
      // do not send correct answers here
    };

    return res.json({ quiz: safeQuiz, email: share.email });
  } catch (err) {
    console.error('GET /student-quiz/token/:token error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Existing route: GET /api/student-quiz/attempt/:token
 * Returns in-progress vs not-started state and (if started) attempt data.
 */
router.get('/attempt/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ message: 'token required' });

    const share = await QuizShare.findOne({ token });
    if (!share) return res.status(404).json({ message: 'Invalid or expired link' });

    if (share.expiresAt && share.expiresAt < new Date()) {
      share.status = 'expired';
      await share.save();
      return res.status(403).json({ message: 'Link expired' });
    }

    // Already submitted?
    const priorSubmitted = await QuizAttempt.findOne({
      uniqueToken: token,
      status: { $in: ['submitted', 'graded'] }
    });
    if (priorSubmitted) {
      try { share.status = 'taken'; await share.save(); } catch (e) { /* ignore */ }
      return res.json({ alreadySubmitted: true, message: 'Quiz already submitted' });
    }

    // In-progress attempt (resume)
    const existingAttempt = await QuizAttempt.findOne({ uniqueToken: token, status: 'in-progress' });
    if (existingAttempt) {
      const quiz = await Quiz.findById(existingAttempt.quizId).lean();
      if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

      return res.json({
        hasStarted: true,
        attemptId: existingAttempt._id,
        quiz: {
          id: quiz._id,
          title: quiz.title,
          description: quiz.description,
          duration: quiz.duration,
          questions: quiz.questions.map(q => ({ id: q.id, type: q.type, question: q.question, options: q.options }))
        },
        studentInfo: {
          name: existingAttempt.studentName,
          usn: existingAttempt.studentUSN,
          email: existingAttempt.studentEmail,
          branch: existingAttempt.studentBranch,
          year: existingAttempt.studentYear,
          semester: existingAttempt.studentSemester
        },
        email: share.email
      });
    }

    // Not started yet: return quiz metadata and optional studentInfo
    const quiz = await Quiz.findById(share.quizId).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    let studentInfo = null;
    try {
      const Student = require('../models/Student');
      const student = await Student.findOne({ email: share.email, userId: share.teacherId }).lean();
      if (student) {
        studentInfo = {
          name: student.name,
          usn: student.usn,
          branch: student.branch,
          year: student.year,
          semester: student.semester
        };
      }
    } catch (e) {
      // ignore if Student model missing
    }

    return res.json({
      hasStarted: false,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        numQuestions: quiz.questions ? quiz.questions.length : quiz.numQuestions || 0
      },
      email: share.email,
      studentInfo
    });
  } catch (err) {
    console.error('GET /student-quiz/attempt/:token error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * POST /api/student-quiz/attempt/start
 * Body: { token, studentName, studentUSN, studentBranch, studentYear, studentSemester }
 */
router.post('/attempt/start', async (req, res) => {
  try {
    const { token, studentName, studentUSN, studentBranch, studentYear, studentSemester } = req.body;
    if (!token) return res.status(400).json({ message: 'token required' });
    if (!studentName || !studentUSN || !studentBranch || !studentYear || !studentSemester) {
      return res.status(400).json({ message: 'All student fields are required' });
    }

    const share = await QuizShare.findOne({ token });
    if (!share) return res.status(404).json({ message: 'Invalid link' });
    if (share.expiresAt && share.expiresAt < new Date()) {
      share.status = 'expired';
      await share.save();
      return res.status(403).json({ message: 'Link expired' });
    }
    if (share.status === 'taken') {
      return res.status(403).json({ message: 'Quiz already taken' });
    }

    const quiz = await Quiz.findById(share.quizId).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    // resume if in-progress exists
    let attempt = await QuizAttempt.findOne({ uniqueToken: token, status: 'in-progress' });
    if (attempt) {
      return res.json({
        success: true,
        attemptId: attempt._id,
        quiz: {
          id: quiz._id,
          title: quiz.title,
          description: quiz.description,
          duration: quiz.duration,
          questions: quiz.questions.map(q => ({ id: q.id, type: q.type, question: q.question, options: q.options }))
        }
      });
    }

    const qlen = (quiz.questions && quiz.questions.length) || quiz.numQuestions || 0;
    const answersPlaceholder = new Array(qlen).fill('');

    attempt = await QuizAttempt.create({
      quizId: quiz._id,
      teacherId: quiz.userId || share.teacherId,
      studentName: studentName.trim(),
      studentUSN: studentUSN.trim().toUpperCase(),
      studentEmail: share.email,
      studentBranch: studentBranch.trim(),
      studentYear,
      studentSemester,
      answers: answersPlaceholder,
      uniqueToken: token,
      status: 'in-progress',
      startedAt: new Date()
    });

    return res.json({
      success: true,
      attemptId: attempt._id,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        questions: quiz.questions.map(q => ({ id: q.id, type: q.type, question: q.question, options: q.options }))
      }
    });
  } catch (err) {
    console.error('POST /student-quiz/attempt/start error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * POST /api/student-quiz/attempt/submit
 * Body: { attemptId, answers: [ ... ] }
 */
router.post('/attempt/submit', async (req, res) => {
  try {
    const { attemptId, answers } = req.body;
    if (!attemptId) return res.status(400).json({ message: 'attemptId required' });
    if (!Array.isArray(answers)) return res.status(400).json({ message: 'answers array required' });

    const attempt = await QuizAttempt.findById(attemptId);
    if (!attempt) return res.status(404).json({ message: 'Attempt not found' });
    if (attempt.status === 'submitted' || attempt.status === 'graded') {
      return res.status(400).json({ message: 'Attempt already submitted' });
    }

    const quiz = await Quiz.findById(attempt.quizId).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    const qlen = (quiz.questions && quiz.questions.length) || quiz.numQuestions || 0;
    const provided = answers.slice(0, qlen);
    while (provided.length < qlen) provided.push('');

    let totalMarks = 0;
    let maxMarks = 0;
    const perQuestion = [];

    for (let i = 0; i < qlen; i++) {
      const q = quiz.questions[i];
      const expected = (q && q.answer) ? String(q.answer).trim().toUpperCase() : '';
      const givenRaw = provided[i] != null ? String(provided[i]) : '';
      const given = givenRaw.trim();
      const max = 1;
      maxMarks += max;

      let correct = false;
      let awarded = 0;

      if (q.type === 'mcq') {
        if (expected && given && expected === given.toUpperCase()) {
          correct = true;
          awarded = max;
          totalMarks += awarded;
        }
      } else {
        try {
          if (gradingService && typeof gradingService.gradeShortAnswer === 'function') {
            const grading = await gradingService.gradeShortAnswer(q.question || '', q.answer || '', given);
            awarded = Number(grading.marks || 0);
            correct = !!grading.isCorrect;
            totalMarks += awarded;
            perQuestion.push({
              questionIndex: i,
              correct,
              awarded,
              max,
              expectedAnswer: q.answer || '',
              givenAnswer: given,
              explanation: grading.feedback || grading.explanation || ''
            });
            continue;
          }
        } catch (err) {
          console.error('Short answer grading error:', err);
        }
        awarded = 0;
      }

      perQuestion.push({
        questionIndex: i,
        correct,
        awarded,
        max,
        expectedAnswer: q.answer || '',
        givenAnswer: given
      });
    }

    const percentage = maxMarks > 0 ? Math.round((totalMarks / maxMarks) * 100) : 0;

    attempt.answers = provided;
    attempt.status = 'submitted';
    attempt.submittedAt = new Date();
    attempt.totalMarks = totalMarks;
    attempt.maxMarks = maxMarks;
    attempt.percentage = percentage;
    attempt.perQuestion = perQuestion;

    await attempt.save();

    try {
      await QuizShare.findOneAndUpdate({ token: attempt.uniqueToken }, { status: 'taken' });
    } catch (e) {
      console.warn('Could not update share status to taken:', e);
    }

    return res.json({
      success: true,
      results: {
        totalMarks,
        maxMarks,
        percentage
      }
    });
  } catch (err) {
    console.error('POST /student-quiz/attempt/submit error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
