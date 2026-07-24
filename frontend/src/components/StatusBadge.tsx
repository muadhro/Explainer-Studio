import type { VideoStatus } from '../types';

const LABELS: Record<VideoStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  complete: 'Complete',
  failed: 'Failed',
};

interface StatusBadgeProps {
  status: VideoStatus;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${status}`}>{LABELS[status]}</span>;
}
