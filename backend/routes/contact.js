const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const email = require('../services/emailService');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@explainerstudio.org';

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, email: fromEmail, subject, message } = req.body || {};

    if (!name || !fromEmail || !subject || !message) {
      return res.status(400).json({ message: 'name, email, subject, and message are required' });
    }
    if (!EMAIL_RE.test(fromEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }

    try {
      await email.sendEmail({
        to: SUPPORT_EMAIL,
        replyTo: fromEmail,
        subject: `[Contact] ${subject}`,
        html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(fromEmail)}&gt;</p>
<p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
        text: `From: ${name} <${fromEmail}>\nSubject: ${subject}\n\n${message}`,
      });
    } catch (err) {
      console.error('[contact] Failed to send contact email:', err.message);
      return res.status(502).json({ message: "Couldn't send your message right now. Please try again shortly." });
    }

    res.json({ message: "Thanks — we've received your message and will get back to you soon." });
  }),
);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
