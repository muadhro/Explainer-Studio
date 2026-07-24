import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import * as api from '../api';
import type { BillingInfo, Session } from '../types';

const TABS = ['Profile', 'Security', 'Billing', 'Preferences', 'Privacy'] as const;
type Tab = (typeof TABS)[number];

export default function Account() {
  const [tab, setTab] = useState<Tab>('Profile');

  return (
    <div className="page">
      <h1 className="account-title">Account Settings</h1>
      <div className="account-layout">
        <div className="account-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`account-tabs__item${tab === t ? ' account-tabs__item--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="account-panel">
          {tab === 'Profile' && <ProfileTab />}
          {tab === 'Security' && <SecurityTab />}
          {tab === 'Billing' && <BillingTab />}
          {tab === 'Preferences' && <PreferencesTab />}
          {tab === 'Privacy' && <PrivacyTab />}
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings-card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

// --- 1. Profile ---
function ProfileTab() {
  const { user, refresh } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [title, setTitle] = useState(user?.title || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!user) return null;

  async function saveProfile() {
    setSaving(true);
    setMessage(null);
    try {
      await api.updateProfile({ fullName, title });
      await refresh();
      setMessage('Saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setSaving(true);
      try {
        await api.updateProfile({ avatarDataUrl: reader.result as string });
        await refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Failed to upload avatar');
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }

  const initials = user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <SectionCard title="Profile and Personal Details">
      <div className="avatar-row">
        {user.avatarPath ? (
          <img src={user.avatarPath} alt="" className="avatar-preview" />
        ) : (
          <div className="avatar-preview avatar-preview--placeholder">{initials}</div>
        )}
        <div>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={saving}>
            Upload photo
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFileChange} />
          <p className="field-hint">PNG, JPEG, or WebP. Max 2MB.</p>
        </div>
      </div>

      <label>
        Full Name
        <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={saving} />
      </label>
      <label>
        Email Address
        <input type="email" value={user.email} disabled />
        <span className="field-hint">Contact support to change your email address.</span>
      </label>
      <label>
        Role / Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Instructional Designer"
          disabled={saving}
        />
      </label>

      {message && <div className="settings-message">{message}</div>}
      <button type="button" className="pill-button" onClick={saveProfile} disabled={saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </SectionCard>
  );
}

// --- 2. Security ---
function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    api.listSessions().then(setSessions).catch(() => {});
  }, []);

  async function handlePasswordChange() {
    setMessage(null);
    if (newPassword.length < 8) return setMessage('New password must be at least 8 characters.');
    if (newPassword !== confirmPassword) return setMessage('Passwords do not match.');

    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(id: string) {
    await api.revokeSession(id);
    setSessions(await api.listSessions());
  }

  async function handleLogoutOthers() {
    await api.logoutOtherSessions();
    setSessions(await api.listSessions());
  }

  return (
    <>
      <SectionCard title="Password">
        <label>
          Current Password
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} disabled={saving} />
        </label>
        <label>
          New Password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={saving} />
        </label>
        <label>
          Confirm New Password
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={saving} />
        </label>
        {message && <div className="settings-message">{message}</div>}
        <button type="button" className="pill-button" onClick={handlePasswordChange} disabled={saving}>
          {saving ? 'Updating…' : 'Update Password'}
        </button>
      </SectionCard>

      <SectionCard title="Two-Factor Authentication">
        <div className="toggle-row">
          <div>
            <div className="toggle-row__label">Authenticator app or SMS</div>
            <div className="field-hint">Coming soon — not yet configured for this deployment.</div>
          </div>
          <label className="switch switch--disabled">
            <input type="checkbox" disabled />
            <span className="switch__track" />
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Active Sessions">
        {sessions.map((s) => (
          <div key={s.id} className="session-row">
            <div>
              <div className="session-row__device">
                {s.userAgent}
                {s.current && <span className="session-row__badge">This device</span>}
              </div>
              <div className="field-hint">Last active {new Date(s.lastSeenAt).toLocaleString()}</div>
            </div>
            {!s.current && (
              <button type="button" onClick={() => handleRevoke(s.id)}>
                Revoke
              </button>
            )}
          </div>
        ))}
        {sessions.length > 1 && (
          <button type="button" className="danger-link" onClick={handleLogoutOthers}>
            Log out of all other devices
          </button>
        )}
      </SectionCard>

      <SectionCard title="Connected Accounts">
        {['Google', 'Microsoft', 'GitHub'].map((provider) => (
          <div className="toggle-row" key={provider}>
            <div className="toggle-row__label">{provider}</div>
            <button type="button" disabled title={`${provider} SSO requires OAuth credentials to be configured`}>
              Connect
            </button>
          </div>
        ))}
      </SectionCard>
    </>
  );
}

// --- 3. Billing ---
function BillingTab() {
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingInfo | null>(null);

  useEffect(() => {
    api.fetchBilling().then(setBilling).catch(() => {});
  }, []);

  if (!billing) return <SectionCard title="Current Plan"><p>Loading…</p></SectionCard>;

  const pct = Math.min(100, Math.round((billing.usage.videosUsed / billing.usage.videosLimit) * 100));

  return (
    <>
      <SectionCard title="Current Plan">
        <div className="plan-summary">
          <div>
            <div className="plan-summary__name">
              {billing.plan.name} Plan
              {billing.plan.basePrice > 0 && <span> · ${billing.plan.price.monthly}/mo</span>}
            </div>
            <div className="field-hint">
              Billed every {billing.plan.cycle} month{billing.plan.cycle > 1 ? 's' : ''}
              {billing.plan.cycle > 1 && ` · $${billing.plan.price.total} per term`}
            </div>
          </div>
          <button type="button" className="pill-button" onClick={() => navigate('/pricing')}>
            Manage Plan
          </button>
        </div>

        <div className="usage-bar">
          <div className="usage-bar__fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="field-hint">
          {billing.usage.videosUsed} of {billing.usage.videosLimit} videos used this month
        </p>
      </SectionCard>

      <SectionCard title="Payment Methods">
        <p className="field-hint">No payment method on file.</p>
        <button type="button" disabled title="Connect a payment processor (e.g. Stripe) to accept cards">
          Add Payment Method
        </button>
      </SectionCard>

      <SectionCard title="Invoices and Receipts">
        {billing.invoices.length === 0 ? (
          <p className="field-hint">No invoices yet — this plan hasn't been billed.</p>
        ) : (
          <ul>{/* future: map real invoices */}</ul>
        )}
      </SectionCard>
    </>
  );
}

// --- 4. Preferences ---
function PreferencesTab() {
  const { user, refresh } = useAuth();
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  async function update(fields: Parameters<typeof api.updatePreferences>[0]) {
    setSaving(true);
    try {
      await api.updatePreferences(fields);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SectionCard title="Notifications">
        <ToggleRow
          label="Product updates"
          checked={!!user.notifyProduct}
          disabled={saving}
          onChange={(v) => update({ notifyProduct: v })}
        />
        <ToggleRow
          label="Marketing emails"
          checked={!!user.notifyMarketing}
          disabled={saving}
          onChange={(v) => update({ notifyMarketing: v })}
        />
        <ToggleRow
          label="Billing alerts"
          checked={!!user.notifyBilling}
          disabled={saving}
          onChange={(v) => update({ notifyBilling: v })}
        />
      </SectionCard>

      <SectionCard title="Localization">
        <label>
          Language
          <select value={user.locale} onChange={(e) => update({ locale: e.target.value })} disabled={saving}>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="es-ES">Español</option>
            <option value="fr-FR">Français</option>
            <option value="de-DE">Deutsch</option>
            <option value="hi-IN">हिन्दी</option>
          </select>
        </label>
        <label>
          Time Zone
          <select
            value={user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
            onChange={(e) => update({ timezone: e.target.value })}
            disabled={saving}
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
      </SectionCard>

      <SectionCard title="Appearance">
        <div className="theme-picker">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`theme-picker__option${user.theme === t ? ' theme-picker__option--active' : ''}`}
              onClick={() => update({ theme: t })}
              disabled={saving}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </SectionCard>
    </>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-row__label">{label}</div>
      <label className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch__track" />
      </label>
    </div>
  );
}

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

// --- 5. Privacy ---
function PrivacyTab() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await api.deleteAccount(password);
      await logout();
      navigate('/pricing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <SectionCard title="Your Data">
        <p className="field-hint">Download a copy of your account details and every video you've generated.</p>
        <a className="pill-button pill-button--link" href={api.exportAccountUrl()}>
          Export My Data
        </a>
      </SectionCard>

      <SectionCard title="Policies">
        <p>
          <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a>
          {' · '}
          <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
        </p>
      </SectionCard>

      <SectionCard title="Delete Account">
        <p className="field-hint">
          This permanently deletes your account, every generated video, and all account data. This cannot be undone.
        </p>
        {!confirmOpen ? (
          <button type="button" className="danger-button" onClick={() => setConfirmOpen(true)}>
            Delete Account
          </button>
        ) : (
          <div className="delete-confirm">
            <label>
              Confirm your password to continue
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={deleting} />
            </label>
            {error && <div className="error-text">{error}</div>}
            <div className="delete-confirm__actions">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={handleDelete} disabled={deleting || !password}>
                {deleting ? 'Deleting…' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        )}
      </SectionCard>
    </>
  );
}
