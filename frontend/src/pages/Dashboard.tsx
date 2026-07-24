import { useEffect, useMemo, useState, useCallback } from 'react';
import { listVideos, deleteVideo } from '../api';
import type { Video, VideoStatus } from '../types';
import VideoCard from '../components/VideoCard';

type SortKey = 'date' | 'status';

const POLL_INTERVAL_MS = 4000;

export default function Dashboard() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [totalStorageMB, setTotalStorageMB] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VideoStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVideos = useCallback(async () => {
    try {
      const data = await listVideos();
      setVideos(data.videos);
      setTotalStorageMB(data.totalStorageMB);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
    const interval = setInterval(fetchVideos, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchVideos]);

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this video? This cannot be undone.')) return;
    try {
      await deleteVideo(id);
      setVideos((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete video');
    }
  }

  const filteredVideos = useMemo(() => {
    let result = videos;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((v) => v.title.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      result = result.filter((v) => v.status === statusFilter);
    }

    result = [...result].sort((a, b) => {
      if (sortKey === 'status') {
        return a.status.localeCompare(b.status);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }, [videos, search, statusFilter, sortKey]);

  return (
    <div className="page">
      <div className="dashboard-header">
        <h1>Your Videos</h1>
        <span className="storage-badge">You're using {totalStorageMB.toFixed(1)} MB</span>
      </div>

      <div className="dashboard-controls">
        <input
          type="text"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as VideoStatus | 'all')}>
          <option value="all">All statuses</option>
          <option value="queued">Queued</option>
          <option value="processing">Processing</option>
          <option value="complete">Complete</option>
          <option value="failed">Failed</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="date">Sort by date</option>
          <option value="status">Sort by status</option>
        </select>
      </div>

      {error && <div className="error-text">{error}</div>}

      {loading ? (
        <p>Loading…</p>
      ) : filteredVideos.length === 0 ? (
        <p>No videos found.</p>
      ) : (
        <table className="video-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredVideos.map((video) => (
              <VideoCard key={video.id} video={video} onDelete={handleDelete} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
