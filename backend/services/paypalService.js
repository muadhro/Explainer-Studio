const fetch = require('node-fetch');
const db = require('../database/db');
const { getPlan, priceForPlan } = require('../config/plans');

const API_BASE =
  (process.env.PAYPAL_MODE || 'sandbox').toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

let cachedToken = null; // { accessToken, expiresAt }

/** OAuth2 client-credentials token, cached until ~1 minute before expiry. */
async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set');
  }

  const response = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`PayPal OAuth error (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.accessToken;
}

async function paypalRequest(path, { method = 'GET', body, idempotencyKey } = {}) {
  const token = await getAccessToken();
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  if (idempotencyKey) headers['PayPal-Request-Id'] = idempotencyKey;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`PayPal API error (${response.status}) on ${method} ${path}: ${text}`);
  }
  return data;
}

/**
 * Get (or lazily create) the PayPal Product + Billing Plan for a given tier
 * and commitment term. Results are cached in Postgres so each combo is only
 * created once with PayPal, ever.
 */
async function ensurePaypalPlan(planId, cycleMonths) {
  const cached = await db.getPaypalPlan(planId, cycleMonths);
  if (cached) return cached;

  const plan = getPlan(planId);
  const price = priceForPlan(planId, cycleMonths);
  if (price.total <= 0) {
    throw new Error(`Cannot create a PayPal plan for a $0 price (${planId})`);
  }

  const product = await paypalRequest('/v1/catalogs/products', {
    method: 'POST',
    idempotencyKey: `product-${planId}`,
    body: {
      name: `Explainer Studio - ${plan.name}`,
      description: `${plan.name} plan (${plan.videosPerMonth} videos/month)`,
      type: 'SERVICE',
      category: 'SOFTWARE',
    },
  });

  const billingPlan = await paypalRequest('/v1/billing/plans', {
    method: 'POST',
    idempotencyKey: `plan-${planId}-${cycleMonths}`,
    body: {
      product_id: product.id,
      name: `${plan.name} - billed every ${cycleMonths} month${cycleMonths > 1 ? 's' : ''}`,
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: cycleMonths },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0, // 0 = renews indefinitely until cancelled
          pricing_scheme: {
            fixed_price: { value: price.total.toFixed(2), currency_code: 'USD' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    },
  });

  const entry = {
    planId,
    cycleMonths,
    paypalProductId: product.id,
    paypalPlanId: billingPlan.id,
    createdAt: new Date().toISOString(),
  };
  await db.savePaypalPlan(entry);
  return entry;
}

/** Create a subscription for the buyer and return its PayPal approval URL. */
async function createSubscription({ planId, cycleMonths, returnUrl, cancelUrl, subscriberEmail, subscriberName }) {
  const { paypalPlanId } = await ensurePaypalPlan(planId, cycleMonths);

  const [givenName, ...rest] = (subscriberName || 'Customer').trim().split(' ');
  const subscription = await paypalRequest('/v1/billing/subscriptions', {
    method: 'POST',
    body: {
      plan_id: paypalPlanId,
      subscriber: {
        name: { given_name: givenName || 'Customer', surname: rest.join(' ') || '-' },
        email_address: subscriberEmail,
      },
      application_context: {
        brand_name: 'Explainer Studio',
        locale: 'en-US',
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: 'SUBSCRIBE_NOW',
      },
    },
  });

  const approveLink = subscription.links.find((l) => l.rel === 'approve');
  return { subscriptionId: subscription.id, approveUrl: approveLink && approveLink.href };
}

async function getSubscription(subscriptionId) {
  return paypalRequest(`/v1/billing/subscriptions/${subscriptionId}`);
}

/** Cancel a live subscription so it will not auto-renew or bill again. */
async function cancelSubscription(subscriptionId, reason) {
  await paypalRequest(`/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: { reason: reason || 'Auto-renewal turned off by customer' },
  });
}

module.exports = { ensurePaypalPlan, createSubscription, getSubscription, cancelSubscription };
