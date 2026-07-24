import type {
  CreateVideoRequest,
  CreateVideoResponse,
  VideoListResponse,
  Voice,
  User,
  Session,
  BillingInfo,
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

export function exportAccountUrl(): string {
  return '/api/account/export';
}

export async function deleteAccount(password: string): Promise<void> {
  const response = await jsonFetch('/api/account/delete', 'POST', { password });
  await handleResponse(response);
}
