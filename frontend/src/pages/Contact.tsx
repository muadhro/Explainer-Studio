import { useState, FormEvent } from 'react';
import { submitContactForm } from '../api';

export default function Contact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!name || !email || !subject || !message) {
      setError('Please fill in every field.');
      return;
    }
    setSubmitting(true);
    try {
      const msg = await submitContactForm({ name, email, subject, message });
      setNotice(msg);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <h1>Contact Us</h1>
      <p className="page-subtitle">
        Questions, feedback, or a problem with your account? Send us a message and we'll get back to
        you at <a href="mailto:support@explainerstudio.org">support@explainerstudio.org</a>.
      </p>

      <div className="settings-card" style={{ maxWidth: 560, margin: '0 auto' }}>
        {notice ? (
          <p className="auth-note">{notice}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label>
              Your Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
            </label>
            <label>
              Your Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} />
            </label>
            <label>
              Subject
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={submitting} />
            </label>
            <label>
              Message
              <textarea
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={submitting}
              />
            </label>

            {error && <div className="error-text">{error}</div>}

            <button type="button" className="pill-button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
