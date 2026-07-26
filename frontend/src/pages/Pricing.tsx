import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchBilling, switchPlan, createPaypalSubscription, confirmPaypalSubscription } from '../api';
import type { BillingInfo } from '../types';

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [cycleMonths, setCycleMonths] = useState(1);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<{
    id: string;
    name: string;
    cycleMonths: number;
    cycleLabel: string;
    monthly: number;
    total: number;
  } | null>(null);
  const [billingCountry, setBillingCountry] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingZip, setBillingZip] = useState('');
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchBilling()
      .then((b) => {
        setBilling(b);
        setCycleMonths(b.plan.cycle);
      })
      .catch(() => {});
  }, [user]);

  // Handle the redirect back from PayPal after the buyer approves (or cancels)
  useEffect(() => {
    const paypalResult = searchParams.get('paypal');
    if (!paypalResult || !user) return;

    if (paypalResult === 'cancelled') {
      setNotice('Checkout was cancelled — your plan was not changed.');
      setSearchParams({}, { replace: true });
      return;
    }

    if (paypalResult === 'success') {
      const subscriptionId = searchParams.get('subscription_id');
      if (!subscriptionId) {
        setError("PayPal didn't return a subscription id.");
        setSearchParams({}, { replace: true });
        return;
      }
      confirmPaypalSubscription(subscriptionId)
        .then(async () => {
          setNotice('Payment approved — your plan is now active.');
          setBilling(await fetchBilling());
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to confirm the PayPal subscription');
        })
        .finally(() => setSearchParams({}, { replace: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

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

  function handleSelect(planId: string) {
    setError(null);
    setNotice(null);
    if (!user) {
      navigate('/signup');
      return;
    }
    if (planId === billing?.plan.id && cycleMonths === billing?.plan.cycle) return;

    if (planId === 'free') {
      void applyFreePlan(planId);
      return;
    }

    // Paid plans need an explicit confirmation of plan + term + price before
    // we redirect the buyer off-site to PayPal to approve the charge.
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const monthly = priceFor(plan.basePrice);
    setPendingPlan({
      id: planId,
      name: plan.name,
      cycleMonths,
      cycleLabel: activeCycle.label,
      monthly,
      total: Math.round(monthly * cycleMonths * 100) / 100,
    });
  }

  async function applyFreePlan(planId: string) {
    setSwitching(planId);
    try {
      await switchPlan(planId, cycleMonths);
      setBilling(await fetchBilling());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update plan');
    } finally {
      setSwitching(null);
    }
  }

  async function confirmPurchase() {
    if (!pendingPlan) return;
    setError(null);
    setBillingError(null);
    if (!billingCountry || !billingAddress || !billingCity || !billingZip) {
      setBillingError('Country, address, city, and zip code are required.');
      return;
    }

    setSwitching(pendingPlan.id);
    try {
      // Paid plans go through a real PayPal checkout — redirect the buyer
      // to PayPal to approve, then they land back here via the return_url.
      const { approveUrl } = await createPaypalSubscription(pendingPlan.id, pendingPlan.cycleMonths, {
        billingCountry,
        billingAddress,
        billingCity,
        billingZip,
      });
      window.location.href = approveUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setSwitching(null);
      setPendingPlan(null);
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

      {notice && <p className="pricing-notice">{notice}</p>}
      {error && <div className="error-text" style={{ textAlign: 'center', marginBottom: 16 }}>{error}</div>}

      {pendingPlan && (
        <div className="settings-card" style={{ maxWidth: 440, margin: '0 auto 32px' }}>
          <h2>Confirm your subscription</h2>
          <div className="delete-confirm">
            <div className="toggle-row">
              <div className="toggle-row__label">Plan</div>
              <strong>{pendingPlan.name}</strong>
            </div>
            <div className="toggle-row">
              <div className="toggle-row__label">Term</div>
              <strong>{pendingPlan.cycleLabel}</strong>
            </div>
            <div className="toggle-row">
              <div className="toggle-row__label">Price</div>
              <strong>
                ${formatPrice(pendingPlan.monthly)}/mo
                {pendingPlan.cycleMonths > 1 && ` · $${formatPrice(pendingPlan.total)} billed now`}
              </strong>
            </div>
            <label>
              Country / Region
              <input
                type="text"
                value={billingCountry}
                onChange={(e) => setBillingCountry(e.target.value)}
                placeholder="United States"
                disabled={switching === pendingPlan.id}
              />
            </label>
            <label>
              Address
              <input
                type="text"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="123 Main St"
                disabled={switching === pendingPlan.id}
              />
            </label>
            <label>
              City
              <input
                type="text"
                value={billingCity}
                onChange={(e) => setBillingCity(e.target.value)}
                disabled={switching === pendingPlan.id}
              />
            </label>
            <label>
              Zip / Postal Code
              <input
                type="text"
                value={billingZip}
                onChange={(e) => setBillingZip(e.target.value)}
                disabled={switching === pendingPlan.id}
              />
            </label>
            {billingError && <div className="error-text">{billingError}</div>}

            <p className="field-hint">
              You'll be redirected to PayPal to approve this charge. Nothing is billed until you approve it there.
            </p>
            <div className="delete-confirm__actions">
              <button type="button" onClick={() => setPendingPlan(null)} disabled={switching === pendingPlan.id}>
                Back
              </button>
              <button
                type="button"
                className="pill-button"
                onClick={confirmPurchase}
                disabled={switching === pendingPlan.id}
              >
                {switching === pendingPlan.id ? 'Redirecting to PayPal…' : 'Confirm & Continue to PayPal'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                    ? plan.basePrice > 0
                      ? 'Redirecting to PayPal…'
                      : 'Updating…'
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
          {billing.usage.videosLimit === null
            ? `You've generated ${billing.usage.videosUsed} videos this month — unlimited as an admin.`
            : `You've used ${billing.usage.videosUsed} of ${billing.usage.videosLimit} videos this month on the ${billing.plan.name} plan.`}
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
    monthlyCharacterBudget: 15000,
    maxQuality: '720p',
    features: [
      '3 videos / month',
      '15,000 narration characters / month',
      '720p rendering',
      'All animation styles',
      'Studio watermark included',
      '5 studio projects',
      'Community support',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    basePrice: 25,
    videosPerMonth: 20,
    monthlyCharacterBudget: 60000,
    maxQuality: '1080p',
    features: [
      '20 videos / month',
      '60,000 narration characters / month',
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
    monthlyCharacterBudget: 170000,
    maxQuality: '1440p',
    popular: true,
    features: [
      '50 videos / month',
      '170,000 narration characters / month',
      '1440p rendering',
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
    videosPerMonth: 300,
    monthlyCharacterBudget: 1000000,
    maxQuality: '4K',
    features: [
      '300 videos / month',
      '1,000,000 narration characters / month',
      '4K rendering',
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
