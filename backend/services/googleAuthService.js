const crypto = require('crypto');
const fetch = require('node-fetch');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getCallbackUrl() {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
  return `${backendUrl}/api/auth/google/callback`;
}

function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: getCallbackUrl(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

function generateState() {
  return crypto.randomUUID();
}

async function exchangeCodeForTokens(code) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getCallbackUrl(),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google userinfo request failed (${response.status}): ${await response.text()}`);
  }
  return response.json(); // { sub, email, email_verified, name, picture, given_name, family_name }
}

module.exports = {
  isConfigured,
  buildAuthorizationUrl,
  generateState,
  exchangeCodeForTokens,
  fetchGoogleProfile,
};
