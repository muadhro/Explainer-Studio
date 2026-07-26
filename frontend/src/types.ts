export type AnimationStyle = 'Animated Explainer' | 'Kinetic Typography' | 'Motion Graphics' | 'Flat Design 2D' | 'Whiteboard Animation';

export interface User {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  avatarPath: string | null;
  plan: string;
  billingCycle: string;
  planUpdatedAt: string | null;
  theme: 'light' | 'dark' | 'system';
  locale: string;
  timezone: string | null;
  notifyProduct: number;
  notifyMarketing: number;
  notifyBilling: number;
  hasPassword: boolean;
  hasGoogle: boolean;
  role: 'user' | 'admin';
  subscriptionId: string | null;
  createdAt: string;
}

export interface AdminUser extends User {
  planName: string;
  monthlyValue: number;
  videoCount: number;
}

export interface AdminStats {
  totalUsers: number;
  activePaidSubscriptions: number;
  estimatedMRR: number;
  totalVideos: number;
  totalStorageMB: number;
  planCounts: Record<string, number>;
  adminCount: number;
  googleLinkedCount: number;
}

export interface AdminAnalytics {
  totalViews: number;
  uniqueVisitorsAllTime: number;
  uniqueVisitorsToday: number;
  activeNow: number;
  viewsByDay: { day: string; views: number; visitors: number }[];
  topPages: { path: string; views: number }[];
}

export interface Session {
  id: string;
  userId: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface Plan {
  id: string;
  name: string;
  basePrice: number;
  videosPerMonth: number;
  monthlyCharacterBudget: number;
  maxQuality: string;
  popular?: boolean;
  features: string[];
}

export interface BillingCycleOption {
  months: number;
  label: string;
  discountPct: number;
}

export interface BillingInfo {
  subscriptionId: string;
  autoRenew: boolean;
  plan: Plan & { cycle: number; price: { monthly: number; total: number } };
  periodStart: string;
  expiresAt: string | null;
  usage: { videosUsed: number; videosLimit: number | null; charsUsed: number; charsLimit: number | null };
  invoices: unknown[];
  plans: Plan[];
  billingCycles: BillingCycleOption[];
}

export interface Voice {
  id: string;
  name: string;
  description: string;
  gender: string;
  accent: string;
  previewUrl: string | null;
}
export type VideoQuality = '720p' | '1080p' | '1440p' | '4K';
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
  targetDurationMinutes?: number;
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
