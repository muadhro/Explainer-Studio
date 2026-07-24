export type AnimationStyle = 'Animated Explainer' | 'Kinetic Typography' | 'Motion Graphics' | 'Flat Design 2D';

export interface Voice {
  id: string;
  name: string;
  description: string;
  gender: string;
  accent: string;
  previewUrl: string | null;
}
export type VideoQuality = '720p' | '1080p';
export type VideoStatus = 'queued' | 'processing' | 'complete' | 'failed';

export interface Video {
  id: string;
  title: string;
  courseContent: string;
  animationStyle: AnimationStyle;
  quality: VideoQuality;
  status: VideoStatus;
  progress: number;
  falJobId: string | null;
  audioPath: string | null;
  videoPath: string | null;
  fileSize: number | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CreateVideoRequest {
  title: string;
  courseContent: string;
  animationStyle: AnimationStyle;
  quality: VideoQuality;
  voiceId?: string;
}

export interface CreateVideoResponse {
  jobId: string;
  status: VideoStatus;
  message: string;
}

export interface VideoListResponse {
  videos: Video[];
  totalStorageMB: number;
}
