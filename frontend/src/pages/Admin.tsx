import { useEffect, useState } from 'react';
import { fetchAdminUsers, fetchAdminStats } from '../api';
import type { AdminUser, AdminStats } from '../types';

export default function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchAdminUsers(), fetchAdminStats()])
      .then(([u, s]) => {
        setUsers(u);
        setStats(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load admin data'));
  }, []);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
        <h2>All Users</h2>
        {!users ? (
          <p>Loading…</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="video-table admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
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
                      <div className="video-title">{u.fullName}</div>
                      {u.title && <div className="video-meta">{u.title}</div>}
                    </td>
                    <td>{u.email}</td>
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
