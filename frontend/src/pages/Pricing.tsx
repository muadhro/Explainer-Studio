import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchBilling, switchPlan } from '../api';
import type { BillingInfo } from '../types';

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [cycleMonths, setCycleMonths] = useState(1);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchBilling()
      .then((b) => {
        setBilling(b);
        setCycleMonths(b.plan.cycle);
      })
      .catch(() => {});
  }, [user]);

  const cycles = billing?.billingCycles || [
    { months: 1, label: '1 Month', discountPct: 0 },
    { months: 3, label: '3 Months', discountPct: 10 },
    { months: 6, label: '6 Months', discountPct: 15 },
    { months: 12, label: '12 Months', discountPct: 20 },
  ];
  const plans = billing?.plans || FALLBACK_PLANS;
  const activeCycle = cycles.find((c) => c.months === cycleMonths) || cycles[0];

  function priceFor(basePrice: number) {
    const monthly = basePrice * (1 - activeCycle.discountPct / 100);
    return Math.round(monthly * 100) / 100;
  }

  function formatPrice(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  async function handleSelect(planId: string) {
    setError(null);
    if (!user) {
      navigate('/signup');
      return;
    }
    if (planId === billing?.plan.id && cycleMonths === billing?.plan.cycle) return;

    setSwitching(planId);
    try {
      await switchPlan(planId, cycleMonths);
      const updated = await fetchBilling();
      setBilling(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update plan');
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="page page--wide">
      <h1>Simple, transparent pricing.</h1>
      <p className="page-subtitle">Pick a term and lock in your rate. Cancel or change anytime.</p>

      <div className="cycle-toggle">
        {cycles.map((c) => (
          <button
            key={c.months}
            type="button"
            className={`cycle-toggle__option${c.months === cycleMonths ? ' cycle-toggle__option--active' : ''}`}
            onClick={() => setCycleMonths(c.months)}
          >
            {c.label}
            {c.discountPct > 0 && <span className="cycle-toggle__badge">Save {c.discountPct}%</span>}
          </button>
        ))}
      </div>

      {error && <div className="error-text" style={{ textAlign: 'center', marginBottom: 16 }}>{error}</div>}

      <div className="pricing-grid">
        {plans.map((plan) => {
          const price = priceFor(plan.basePrice);
          const isCurrent = user && billing?.plan.id === plan.id && billing?.plan.cycle === cycleMonths;
          const isCurrentPlanDifferentCycle = user && billing?.plan.id === plan.id && billing?.plan.cycle !== cycleMonths;

          return (
            <div key={plan.id} className={`pricing-card${plan.popular ? ' pricing-card--popular' : ''}`}>
              {plan.popular && <span className="pricing-card__badge">Most Popular</span>}
              <div className="pricing-card__name">{plan.name}</div>
              <div className="pricing-card__price">
                <span className="pricing-card__amount">${formatPrice(price)}</span>
                <span className="pricing-card__period">/mo</span>
              </div>
              {activeCycle.discountPct > 0 && plan.basePrice > 0 && (
                <div className="pricing-card__original">${plan.basePrice}/mo billed monthly</div>
              )}
              {cycleMonths > 1 && plan.basePrice > 0 && (
                <div className="pricing-card__term">
                  ${formatPrice(Math.round(price * cycleMonths * 100) / 100)} billed every {cycleMonths} months
                </div>
              )}

              <button
                type="button"
                className={`pricing-card__cta${plan.popular ? ' pricing-card__cta--solid' : ''}`}
                disabled={Boolean(isCurrent) || switching === plan.id}
                onClick={() => handleSelect(plan.id)}
              >
                {isCurrent
                  ? 'Current Plan'
                  : switching === plan.id
                    ? 'Updating…'
                    : isCurrentPlanDifferentCycle
                      ? 'Change Term'
                      : !user
                        ? plan.id === 'free'
                          ? 'Get Started'
                          : 'Sign Up'
                        : plan.basePrice === 0
                          ? 'Downgrade'
                          : 'Upgrade'}
              </button>

              <ul className="pricing-card__features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <CheckIcon /> {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {user && billing && (
        <p className="pricing-usage-note">
          You've used {billing.usage.videosUsed} of {billing.usage.videosLimit} videos this month on the{' '}
          {billing.plan.name} plan.
        </p>
      )}
    </div>
  );
}

// Mirrors backend/config/plans.js so the pricing page renders fully for
// signed-out visitors, who are its primary audience.
const FALLBACK_PLANS = [
  {
    id: 'free',
    name: 'Free',
    basePrice: 0,
    videosPerMonth: 3,
    maxQuality: '720p',
    features: [
      '3 videos / month',
      '720p rendering',
      'Animated Explainer + Flat Design styles',
      'Studio watermark included',
      '5 studio projects',
      'Community support',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    basePrice: 25,
    videosPerMonth: 15,
    maxQuality: '1080p',
    features: [
      '15 videos / month',
      '1080p rendering',
      'All animation styles',
      'No watermark',
      '25 studio projects',
      'Standard render queue',
      'Email support',
    ],
  },
  {
    id: 'creator',
    name: 'Creator',
    basePrice: 65,
    videosPerMonth: 50,
    maxQuality: '1080p',
    popular: true,
    features: [
      '50 videos / month',
      '1080p rendering',
      'All animation styles',
      'Full voice library access',
      '100 studio projects',
      'Priority render queue',
      '3 team seats',
      'Priority support',
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    basePrice: 149,
    videosPerMonth: 500,
    maxQuality: '1080p',
    features: [
      '500 videos / month',
      '1080p rendering',
      'All animation styles',
      'Dedicated render capacity',
      'Unlimited studio projects',
      'White-label output (no branding)',
      '10 team seats + SSO',
      'Dedicated support',
    ],
  },
];

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.2 5.5 10 11.5 3.5" fill="none" stroke="#14b8a6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
