import { useEffect, useState } from 'react';
import { fetchAdminUsers, fetchAdminStats, createAdminUser, deleteAdminUser, manageAdminUser } from '../api';
import { useAuth } from '../AuthContext';
import type { AdminUser, AdminStats } from '../types';

export default function Admin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manageTarget, setManageTarget] = useState<AdminUser | null>(null);
  const [manageRole, setManageRole] = useState<'user' | 'admin'>('user');
  const [manageNewPassword, setManageNewPassword] = useState('');
  const [manageSavingRole, setManageSavingRole] = useState(false);
  const [manageSavingPassword, setManageSavingPassword] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageMessage, setManageMessage] = useState<string | null>(null);

  function loadAll() {
    return Promise.all([fetchAdminUsers(), fetchAdminStats()])
      .then(([u, s]) => {
        setUsers(u);
        setStats(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load admin data'));
  }

  useEffect(() => {
    loadAll();
  }, []);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  async function handleAddUser() {
    setFormError(null);
    if (!fullName || !email || !password) {
      setFormError('Name, email, and password are required.');
      return;
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      await createAdminUser({ fullName, email, password, role });
      setFullName('');
      setEmail('');
      setPassword('');
      setRole('user');
      setAddOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteUser(id: string) {
    setDeletingId(id);
    try {
      await deleteAdminUser(id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeletingId(null);
    }
  }

  function openManage(u: AdminUser) {
    setAddOpen(false);
    setManageTarget(u);
    setManageRole(u.role);
    setManageNewPassword('');
    setManageError(null);
    setManageMessage(null);
  }

  async function handleUpdateRole() {
    if (!manageTarget) return;
    setManageError(null);
    setManageMessage(null);
    setManageSavingRole(true);
    try {
      await manageAdminUser(manageTarget.id, { role: manageRole });
      setManageMessage('Role updated.');
      await loadAll();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setManageSavingRole(false);
    }
  }

  async function handleResetPassword() {
    if (!manageTarget) return;
    setManageError(null);
    setManageMessage(null);
    if (manageNewPassword.length < 8) {
      setManageError('New password must be at least 8 characters.');
      return;
    }
    setManageSavingPassword(true);
    try {
      await manageAdminUser(manageTarget.id, { newPassword: manageNewPassword });
      setManageNewPassword('');
      setManageMessage("Password reset — the user's other sessions have been signed out.");
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setManageSavingPassword(false);
    }
  }

  return (
    <div className="page page--wide">
      <h1>Admin Dashboard</h1>
      <p className="page-subtitle">
        Live account and subscription overview. Not a payment ledger — no real charge has gone
        through yet, so revenue here is estimated from each account's current plan.
      </p>

      {error && <div className="error-text" style={{ textAlign: 'center', marginBottom: 16 }}>{error}</div>}

      {stats && (
        <div className="admin-stats-grid">
          <StatCard label="Total Users" value={String(stats.totalUsers)} />
          <StatCard label="Active Paid Subscriptions" value={String(stats.activePaidSubscriptions)} />
          <StatCard label="Estimated MRR" value={`$${stats.estimatedMRR.toFixed(2)}`} />
          <StatCard label="Total Videos Generated" value={String(stats.totalVideos)} />
          <StatCard label="Storage Used" value={`${stats.totalStorageMB.toFixed(1)} MB`} />
          <StatCard label="Google-Linked Accounts" value={String(stats.googleLinkedCount)} />
        </div>
      )}

      {stats && (
        <div className="settings-card" style={{ marginBottom: 24 }}>
          <h2>Users by Plan</h2>
          <div className="admin-plan-breakdown">
            {Object.entries(stats.planCounts).map(([plan, count]) => (
              <div key={plan} className="admin-plan-breakdown__item">
                <span className="admin-plan-breakdown__count">{count}</span>
                <span className="admin-plan-breakdown__label">{plan}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="settings-card">
        <div className="plan-summary" style={{ marginBottom: addOpen ? 16 : 0 }}>
          <h2 style={{ margin: 0 }}>All Users</h2>
          <button type="button" className="pill-button" onClick={() => setAddOpen((v) => !v)}>
            {addOpen ? 'Cancel' : 'Add User'}
          </button>
        </div>

        {addOpen && (
          <div className="form-panel" style={{ marginBottom: 20 }}>
            <label>
              Full Name
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={saving}
                autoComplete="off"
              />
            </label>
            <label>
              Email Address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={saving}
                autoComplete="off"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={saving}
                autoComplete="new-password"
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} disabled={saving}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {formError && <div className="error-text">{formError}</div>}
            <div className="delete-confirm__actions">
              <button type="button" className="pill-button" onClick={handleAddUser} disabled={saving}>
                {saving ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        )}

        {manageTarget && (
          <div className="form-panel" style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>
              Manage {manageTarget.fullName} <span className="field-hint">({manageTarget.email})</span>
            </h3>

            <label>
              Role
              <select
                value={manageRole}
                onChange={(e) => setManageRole(e.target.value as 'user' | 'admin')}
                disabled={manageSavingRole}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <div className="delete-confirm__actions">
              <button type="button" className="pill-button" onClick={handleUpdateRole} disabled={manageSavingRole}>
                {manageSavingRole ? 'Saving…' : 'Update Role'}
              </button>
            </div>

            <label style={{ marginTop: 16 }}>
              Reset Password
              <input
                type="password"
                value={manageNewPassword}
                onChange={(e) => setManageNewPassword(e.target.value)}
                placeholder="New password (min. 8 characters)"
                disabled={manageSavingPassword}
                autoComplete="new-password"
              />
            </label>
            <div className="delete-confirm__actions">
              <button
                type="button"
                className="pill-button"
                onClick={handleResetPassword}
                disabled={manageSavingPassword}
              >
                {manageSavingPassword ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>

            {manageError && <div className="error-text">{manageError}</div>}
            {manageMessage && <div className="settings-message">{manageMessage}</div>}

            <div className="delete-confirm__actions">
              <button type="button" onClick={() => setManageTarget(null)}>
                Close
              </button>
            </div>
          </div>
        )}

        {!users ? (
          <p>Loading…</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="video-table admin-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Subscription ID</th>
                  <th>Plan</th>
                  <th>Term</th>
                  <th>Est. $/mo</th>
                  <th>Videos</th>
                  <th>Sign-in</th>
                  <th>Role</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.id !== me?.id && (
                        <>
                          <button type="button" onClick={() => openManage(u)} style={{ marginRight: 8 }}>
                            Manage
                          </button>
                          <button
                            type="button"
                            className="danger-link"
                            onClick={() => handleDeleteUser(u.id)}
                            disabled={deletingId === u.id}
                          >
                            {deletingId === u.id ? 'Removing…' : 'Remove'}
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="video-title">{u.fullName}</div>
                      {u.title && <div className="video-meta">{u.title}</div>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className="video-meta">{u.subscriptionId || '—'}</span>
                    </td>
                    <td>
                      <span className={`status-badge status-badge--${u.plan === 'free' ? 'queued' : 'complete'}`}>
                        {u.planName}
                      </span>
                    </td>
                    <td>{u.billingCycle}mo</td>
                    <td>{u.monthlyValue > 0 ? `$${u.monthlyValue.toFixed(2)}` : '—'}</td>
                    <td>{u.videoCount}</td>
                    <td>
                      {u.hasGoogle && <span className="admin-badge">Google</span>}
                      {u.hasPassword && <span className="admin-badge">Password</span>}
                    </td>
                    <td>{u.role === 'admin' && <span className="session-row__badge">Admin</span>}</td>
                    <td>{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-card__value">{value}</div>
      <div className="admin-stat-card__label">{label}</div>
    </div>
  );
}
