import type { CreateVideoRequest, CreateVideoResponse, VideoListResponse, Voice } from './types';

const BASE_URL = '/api/videos';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export async function createVideo(payload: CreateVideoRequest): Promise<CreateVideoResponse> {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<CreateVideoResponse>(response);
}

export async function listVideos(): Promise<VideoListResponse> {
  const response = await fetch(BASE_URL);
  return handleResponse<VideoListResponse>(response);
}

export async function deleteVideo(id: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/${id}`, { method: 'DELETE' });
  await handleResponse(response);
}

export function downloadVideoUrl(id: string): string {
  return `${BASE_URL}/${id}/download`;
}

export function playVideoUrl(id: string): string {
  return `${BASE_URL}/${id}/play`;
}

export async function listVoices(): Promise<Voice[]> {
  const response = await fetch('/api/voices');
  const data = await handleResponse<{ voices: Voice[] }>(response);
  return data.voices;
}
