const fetch = require('node-fetch');

const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Explainer Studio <onboarding@resend.dev>';

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Send a transactional email via Resend. Throws if Resend rejects the request. */
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!isConfigured()) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      text,
      reply_to: replyTo,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }
  return response.json();
}

module.exports = { isConfigured, sendEmail };
