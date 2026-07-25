import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchBilling } from '../api';
import type { BillingInfo } from '../types';

export default function Home() {
  const { user, loading } = useAuth();

  if (loading) return null;
  return user ? <SignedInHome /> : <MarketingHome />;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function SignedInHome() {
  const { user } = useAuth();
  const [billing, setBilling] = useState<BillingInfo | null>(null);

  useEffect(() => {
    fetchBilling().then(setBilling).catch(() => {});
  }, []);

  const firstName = user?.fullName.split(' ')[0] || 'there';

  return (
    <div className="page">
      <h1>Welcome back, {firstName}.</h1>
      <p className="page-subtitle">Here's where your account stands.</p>

      {billing && (
        <div className="subscription-card">
          <div className="subscription-card__top">
            <div>
              <div className="subscription-card__plan">
                {billing.plan.name} Plan
                <span className={`subscription-card__status subscription-card__status--${billing.plan.id === 'free' ? 'free' : 'active'}`}>
                  {billing.plan.id === 'free' ? 'Free' : 'Active'}
                </span>
              </div>
              <div className="subscription-card__id">Subscription ID: {billing.subscriptionId}</div>
            </div>
            <Link to="/pricing" className="pill-button">
              Manage Plan
            </Link>
          </div>

          <div className="subscription-card__row">
            <div>
              <div className="subscription-card__label">
                {billing.plan.id === 'free' ? 'Subscription' : 'Renews on'}
              </div>
              <div className="subscription-card__value">
                {billing.expiresAt ? formatDate(billing.expiresAt) : 'Free — never expires'}
              </div>
            </div>
            <div>
              <div className="subscription-card__label">Started</div>
              <div className="subscription-card__value">{formatDate(billing.periodStart)}</div>
            </div>
            <div>
              <div className="subscription-card__label">Billing Term</div>
              <div className="subscription-card__value">
                {billing.plan.cycle} {billing.plan.cycle === 1 ? 'month' : 'months'}
              </div>
            </div>
          </div>

          <div className="subscription-card__usage">
            {billing.usage.videosLimit === null ? (
              <p className="field-hint">{billing.usage.videosUsed} videos generated this month · Unlimited (admin)</p>
            ) : (
              <>
                <div className="usage-bar">
                  <div
                    className="usage-bar__fill"
                    style={{ width: `${Math.min(100, Math.round((billing.usage.videosUsed / billing.usage.videosLimit) * 100))}%` }}
                  />
                </div>
                <p className="field-hint">
                  {billing.usage.videosUsed} of {billing.usage.videosLimit} videos used this month
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="home-actions">
        <Link to="/upload" className="home-action-card">
          <span className="home-action-card__title">Create a Video</span>
          <span className="home-action-card__desc">Turn course content into an animated explainer</span>
        </Link>
        <Link to="/dashboard" className="home-action-card">
          <span className="home-action-card__title">Your Library</span>
          <span className="home-action-card__desc">View, download, and manage your videos</span>
        </Link>
        <Link to="/account" className="home-action-card">
          <span className="home-action-card__title">Account Settings</span>
          <span className="home-action-card__desc">Profile, security, billing, and preferences</span>
        </Link>
      </div>
    </div>
  );
}

function MarketingHome() {
  return (
    <div className="page">
      <h1>Turn any course into a professional video.</h1>
      <p className="page-subtitle">
        Paste your content, pick a voice and a style, and Explainer Studio does the rest.
      </p>
      <div className="hero-actions">
        <Link to="/signup" className="pill-button">
          Get Started Free
        </Link>
        <Link to="/pricing" className="nav-button nav-button--ghost">
          View Pricing
        </Link>
      </div>

      <div className="home-actions" style={{ marginTop: 56 }}>
        <div className="home-action-card home-action-card--static">
          <span className="home-action-card__title">Animated visuals</span>
          <span className="home-action-card__desc">Motion graphics, slide decks, or a light agency-style explainer look</span>
        </div>
        <div className="home-action-card home-action-card--static">
          <span className="home-action-card__title">20+ narration voices</span>
          <span className="home-action-card__desc">Pick a male or female voice and preview it before you generate</span>
        </div>
        <div className="home-action-card home-action-card--static">
          <span className="home-action-card__title">Ready in minutes</span>
          <span className="home-action-card__desc">Full narrated video, rendered locally, no editing required</span>
        </div>
      </div>
    </div>
  );
}
