// services/emailService.js
// Hybrid email service: Use SendGrid in production (SENDGRID_API_KEY).
// Fall back to Nodemailer (Gmail) for local development when SENDGRID isn't configured.

const isSendGrid = !!process.env.SENDGRID_API_KEY;

let sendGrid;
let nodemailer;
let transporter;

if (isSendGrid) {
  sendGrid = require('@sendgrid/mail');
  sendGrid.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000
  });
}

class EmailService {
  constructor() {
    this.from = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@example.com';
    this.provider = isSendGrid ? 'sendgrid' : 'nodemailer';
    console.log(`EmailService initialized using: ${this.provider}`);
  }

  _buildHtml(teacherName, quizTitle, uniqueLink, message = '') {
    return `
      <!doctype html>
      <html>
      <head><meta charset="utf-8"/></head>
      <body style="font-family: Arial, sans-serif; color:#333; line-height:1.6;">
        <div style="max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:30px;border-radius:10px 10px 0 0;text-align:center;">
            <h1 style="margin:0"> Quiz Invitation</h1>
          </div>
          <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
            <h2>Hello!</h2>
            <p>You have been invited by <strong>${teacherName}</strong> to attempt a quiz.</p>
            ${message ? `<div style="background:#fff;padding:15px;border-left:4px solid #667eea;margin:15px 0;"><p><strong>Message:</strong> ${message}</p></div>` : ''}
            <div style="background:#fff;padding:15px;border-left:4px solid #667eea;margin:15px 0;">
              <h3 style="margin-top:0">Quiz: ${quizTitle}</h3>
              <p style="margin-bottom:0">Click the button below to access your personalized quiz link.</p>
            </div>
            <p style="text-align:center;margin:20px 0;">
              <a href="${uniqueLink}" style="display:inline-block;padding:12px 20px;background:#667eea;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Start Quiz</a>
            </p>
            <div style="background:#fff;padding:15px;border-left:4px solid #667eea;margin:15px 0;">
              <p style="margin:0"><strong>Link:</strong> <a href="${uniqueLink}">${uniqueLink}</a></p>
            </div>
            <p>Good luck with your quiz!</p>
            <p style="font-size:12px;color:#666;margin-top:20px;">This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendQuizInvitation(studentEmail, quizTitle, uniqueLink, teacherName, message = '') {
    const subject = `Quiz Invitation: ${quizTitle}`;
    const html = this._buildHtml(teacherName, quizTitle, uniqueLink, message);
    const text = `You have been invited to take a quiz: ${uniqueLink}`;

    if (isSendGrid) {
      const msg = { to: studentEmail, from: this.from, subject, text, html };
      try {
        await sendGrid.send(msg);
        return { success: true };
      } catch (err) {
        const details = err?.response?.body || err?.message || String(err);
        console.error('SendGrid send error', details);
        throw new Error('Failed to send email: ' + (typeof details === 'string' ? details : JSON.stringify(details)));
      }
    } else {
      const mailOptions = { from: `"${teacherName}" <${this.from}>`, to: studentEmail, subject, text, html };
      try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully (nodemailer):', info.messageId);
        return { success: true, messageId: info.messageId };
      } catch (error) {
        console.error('Nodemailer send error:', error);
        throw new Error(`Failed to send email: ${error.message || String(error)}`);
      }
    }
  }

  async verifyConnection() {
    if (isSendGrid) return !!process.env.SENDGRID_API_KEY;
    try {
      await transporter.verify();
      console.log('Nodemailer transporter verified');
      return true;
    } catch (err) {
      console.error('Nodemailer verify error:', err);
      return false;
    }
  }
}

module.exports = new EmailService();
