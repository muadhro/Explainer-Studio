import { useState } from 'react';
import type { Video } from '../types';
import StatusBadge from './StatusBadge';
import { downloadVideoUrl, playVideoUrl, thumbnailUrl } from '../api';

interface VideoCardProps {
  video: Video;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  retrying?: boolean;
}

export default function VideoCard({ video, onDelete, onRetry, retrying }: VideoCardProps) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const created = new Date(video.createdAt).toLocaleString();
  const showThumb = video.status === 'complete' && !thumbFailed;

  return (
    <>
      <tr>
        <td>
          <div className="video-title-row">
            {showThumb && (
              <img
                src={thumbnailUrl(video.id)}
                alt=""
                className="video-thumb"
                onError={() => setThumbFailed(true)}
              />
            )}
            <div>
              <div className="video-title">{video.title}</div>
              <div className="video-meta">
                {video.animationStyle} · {video.quality}
                {video.fileSize ? ` · ${video.fileSize} MB` : ''}
              </div>
            </div>
          </div>
        </td>
        <td>
          <StatusBadge status={video.status} />
          {video.status === 'failed' && video.errorMessage && (
            <div className="error-text">{video.errorMessage}</div>
          )}
        </td>
        <td>
          {video.status === 'processing' || video.status === 'queued' ? (
            <div className="progress-bar">
              <div className="progress-bar__fill" style={{ width: `${video.progress}%` }} />
              <span>{video.progress}%</span>
            </div>
          ) : (
            <span>{video.status === 'complete' ? '100%' : '—'}</span>
          )}
        </td>
        <td>{created}</td>
        <td className="actions">
          {video.status === 'complete' && (
            <>
              <a href={downloadVideoUrl(video.id)}>Download</a>
              <button type="button" onClick={() => setShowPlayer((v) => !v)}>
                {showPlayer ? 'Hide' : 'View'}
              </button>
            </>
          )}
          {video.status === 'failed' && (
            <button type="button" onClick={() => onRetry(video.id)} disabled={retrying}>
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          )}
          <button type="button" onClick={() => onDelete(video.id)}>
            Delete
          </button>
        </td>
      </tr>
      {showPlayer && video.status === 'complete' && (
        <tr className="video-player-row">
          <td colSpan={5}>
            <video controls src={playVideoUrl(video.id)} className="video-player" />
          </td>
        </tr>
      )}
    </>
  );
}
