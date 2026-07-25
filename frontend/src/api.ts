import type {
  CreateVideoRequest,
  CreateVideoResponse,
  VideoListResponse,
  Voice,
  User,
  Session,
  BillingInfo,
  AdminUser,
  AdminStats,
} from './types';

const VIDEOS_URL = '/api/videos';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      // The session cookie is stale/invalid (deleted account, expired session,
      // revoked from another device, etc). Tell AuthContext so it clears the
      // cached user instead of leaving the UI showing a half-loaded, logged-in
      // page for an account that no longer has a valid session.
      window.dispatchEvent(new Event('auth:session-expired'));
    }
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message || `Request failed with status ${response.status}`);
  }
  return response.json();
}

function apiFetch(url: string, options: RequestInit = {}) {
  return fetch(url, { credentials: 'include', ...options });
}

function jsonFetch(url: string, method: string, body?: unknown) {
  return apiFetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// --- Videos ---
export async function createVideo(payload: CreateVideoRequest): Promise<CreateVideoResponse> {
  const response = await jsonFetch(VIDEOS_URL, 'POST', payload);
  return handleResponse<CreateVideoResponse>(response);
}

export async function listVideos(): Promise<VideoListResponse> {
  const response = await apiFetch(VIDEOS_URL);
  return handleResponse<VideoListResponse>(response);
}

export async function deleteVideo(id: string): Promise<void> {
  const response = await apiFetch(`${VIDEOS_URL}/${id}`, { method: 'DELETE' });
  await handleResponse(response);
}

export async function retryVideo(id: string): Promise<void> {
  const response = await apiFetch(`${VIDEOS_URL}/${id}/retry`, { method: 'POST' });
  await handleResponse(response);
}

export function downloadVideoUrl(id: string): string {
  return `${VIDEOS_URL}/${id}/download`;
}

export function playVideoUrl(id: string): string {
  return `${VIDEOS_URL}/${id}/play`;
}

export async function listVoices(): Promise<Voice[]> {
  const response = await apiFetch('/api/voices');
  const data = await handleResponse<{ voices: Voice[] }>(response);
  return data.voices;
}

// --- Auth ---
export async function signup(fullName: string, email: string, password: string): Promise<User> {
  const response = await jsonFetch('/api/auth/signup', 'POST', { fullName, email, password });
  const data = await handleResponse<{ user: User }>(response);
  return data.user;
}

export async function login(email: string, password: string): Promise<User> {
  const response = await jsonFetch('/api/auth/login', 'POST', { email, password });
  const data = await handleResponse<{ user: User }>(response);
  return data.user;
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' });
}

export async function fetchCurrentUser(): Promise<User | null> {
  const response = await apiFetch('/api/auth/me');
  const data = await handleResponse<{ user: User | null }>(response);
  return data.user;
}

export async function forgotPassword(email: string): Promise<string> {
  const response = await jsonFetch('/api/auth/forgot-password', 'POST', { email });
  const data = await handleResponse<{ message: string }>(response);
  return data.message;
}

export async function resetPassword(token: string, password: string): Promise<User> {
  const response = await jsonFetch('/api/auth/reset-password', 'POST', { token, password });
  const data = await handleResponse<{ user: User }>(response);
  return data.user;
}

// --- Contact ---
export async function submitContactForm(payload: {
  name: string;
  email: string;
  subject: string;
  message: string;
}): Promise<string> {
  const response = await jsonFetch('/api/contact', 'POST', payload);
  const data = await handleResponse<{ message: string }>(response);
  return data.message;
}

// --- Account ---
export async function updateProfile(fields: {
  fullName?: string;
  title?: string;
  avatarDataUrl?: string;
}): Promise<User> {
  const response = await apiFetch('/api/account/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await handleResponse<{ user: User }>(response);
  return data.user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await jsonFetch('/api/account/password', 'POST', { currentPassword, newPassword });
  await handleResponse(response);
}

export async function listSessions(): Promise<Session[]> {
  const response = await apiFetch('/api/account/sessions');
  const data = await handleResponse<{ sessions: Session[] }>(response);
  return data.sessions;
}

export async function revokeSession(id: string): Promise<void> {
  await apiFetch(`/api/account/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
}

export async function logoutOtherSessions(): Promise<void> {
  await apiFetch('/api/account/sessions/logout-others', { method: 'POST' });
}

export async function updatePreferences(fields: {
  theme?: string;
  locale?: string;
  timezone?: string;
  notifyProduct?: boolean;
  notifyMarketing?: boolean;
  notifyBilling?: boolean;
}): Promise<User> {
  const response = await apiFetch('/api/account/preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await handleResponse<{ user: User }>(response);
  return data.user;
}

export async function fetchBilling(): Promise<BillingInfo> {
  const response = await apiFetch('/api/account/billing');
  return handleResponse<BillingInfo>(response);
}

export async function switchPlan(planId: string, billingCycle: number): Promise<{ user: User; message: string }> {
  const response = await jsonFetch('/api/account/billing/plan', 'POST', { planId, billingCycle });
  return handleResponse(response);
}

export async function updateAutoRenew(autoRenew: boolean): Promise<User> {
  const response = await jsonFetch('/api/account/billing/auto-renew', 'PATCH', { autoRenew });
  const data = await handleResponse<{ user: User }>(response);
  return data.user;
}

export async function createPaypalSubscription(
  planId: string,
  billingCycle: number,
  billingInfo: { billingCountry: string; billingAddress: string; billingCity: string; billingZip: string },
): Promise<{ subscriptionId: string; approveUrl: string }> {
  const response = await jsonFetch('/api/account/billing/paypal/create-subscription', 'POST', {
    planId,
    billingCycle,
    ...billingInfo,
  });
  return handleResponse(response);
}

export async function confirmPaypalSubscription(
  subscriptionId: string,
): Promise<{ user: User; message: string }> {
  const response = await jsonFetch('/api/account/billing/paypal/confirm', 'POST', { subscriptionId });
  return handleResponse(response);
}

export function exportAccountUrl(): string {
  return '/api/account/export';
}

export async function deleteAccount(password: string): Promise<void> {
  const response = await jsonFetch('/api/account/delete', 'POST', { password });
  await handleResponse(response);
}

// --- Admin ---
export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const response = await apiFetch('/api/admin/users');
  const data = await handleResponse<{ users: AdminUser[] }>(response);
  return data.users;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const response = await apiFetch('/api/admin/stats');
  return handleResponse<AdminStats>(response);
}

export async function createAdminUser(payload: {
  fullName: string;
  email: string;
  password: string;
  role?: 'user' | 'admin';
}): Promise<User> {
  const response = await jsonFetch('/api/admin/users', 'POST', payload);
  const data = await handleResponse<{ user: User }>(response);
  return data.user;
}

export async function deleteAdminUser(id: string): Promise<void> {
  const response = await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
  await handleResponse<{ message: string }>(response);
}

export async function manageAdminUser(
  id: string,
  fields: { role?: 'user' | 'admin'; newPassword?: string },
): Promise<User> {
  const response = await jsonFetch(`/api/admin/users/${id}`, 'PATCH', fields);
  const data = await handleResponse<{ user: User }>(response);
  return data.user;
}
