// Rendering resolutions, ordered low to high — a plan's maxQuality unlocks
// everything at or below its own position in this list.
const QUALITY_ORDER = ['720p', '1080p', '1440p', '4K'];

// Plan catalogue. basePrice is the 1-month price; longer commitments apply
// discountPct off that base and are billed as one lump sum for the term.
const PLANS = [
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
      'All animation styles',
      'Dedicated render capacity',
      'Unlimited studio projects',
      'White-label output (no branding)',
      '10 team seats + SSO',
      'Dedicated support',
    ],
  },
];

// Commitment terms: longer terms discount the monthly-equivalent price.
const BILLING_CYCLES = [
  { months: 1, label: '1 Month', discountPct: 0 },
  { months: 3, label: '3 Months', discountPct: 10 },
  { months: 6, label: '6 Months', discountPct: 15 },
  { months: 12, label: '12 Months', discountPct: 20 },
];

function getPlan(planId) {
  return PLANS.find((p) => p.id === planId) || PLANS[0];
}

function getCycle(months) {
  return BILLING_CYCLES.find((c) => String(c.months) === String(months)) || BILLING_CYCLES[0];
}

function priceForPlan(planId, months) {
  const plan = getPlan(planId);
  const cycle = getCycle(months);
  const monthly = plan.basePrice * (1 - cycle.discountPct / 100);
  return {
    monthly: Math.round(monthly * 100) / 100,
    total: Math.round(monthly * cycle.months * 100) / 100,
  };
}

module.exports = { PLANS, BILLING_CYCLES, QUALITY_ORDER, getPlan, getCycle, priceForPlan };
