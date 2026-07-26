import { useEffect, useRef, useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createVideo, listVoices, fetchBilling } from '../api';
import AppleSelect from '../components/AppleSelect';
import { useAuth } from '../AuthContext';
import type { AnimationStyle, VideoQuality, Voice, BillingInfo, ContentDepth } from '../types';

const ANIMATION_STYLES: AnimationStyle[] = [
  'Animated Explainer',
  'Kinetic Typography',
  'Motion Graphics',
  'Flat Design 2D',
  'Whiteboard Animation',
];
const QUALITIES: VideoQuality[] = ['720p', '1080p', '1440p', '4K'];
const QUALITY_ORDER: VideoQuality[] = ['720p', '1080p', '1440p', '4K'];
const DURATIONS = [
  { value: 1, label: '~1 minute', chars: 900 },
  { value: 2, label: '~2 minutes', chars: 1800 },
  { value: 3, label: '~3 minutes', chars: 2700 },
  { value: 5, label: '~5 minutes', chars: 4500 },
];

export default function Upload() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingInfo | null>(null);

  useEffect(() => {
    fetchBilling().then(setBilling).catch(() => {});
  }, []);

  const isAdmin = user?.role === 'admin';
  const maxAllowedIndex = isAdmin
    ? QUALITY_ORDER.length - 1
    : QUALITY_ORDER.indexOf((billing?.plan.maxQuality as VideoQuality) || '720p');

  function lockedFor(q: VideoQuality) {
    return !isAdmin && QUALITY_ORDER.indexOf(q) > maxAllowedIndex;
  }

  function planRequiredFor(q: VideoQuality) {
    if (!billing) return null;
    const candidates = billing.plans.filter(
      (p) => QUALITY_ORDER.indexOf(p.maxQuality as VideoQuality) >= QUALITY_ORDER.indexOf(q),
    );
    return candidates[0]?.name || null;
  }

  const [title, setTitle] = useState('');
  const [courseContent, setCourseContent] = useState('');
  const [animationStyle, setAnimationStyle] = useState<AnimationStyle>(ANIMATION_STYLES[0]);
  const [quality, setQuality] = useState<VideoQuality>('720p');
  const [targetDurationMinutes, setTargetDurationMinutes] = useState(2);
  const [contentDepth, setContentDepth] = useState<ContentDepth>('standard');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [playing, setPlaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selectedVoice = voices.find((v) => v.id === voiceId);

  function stopPreview() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(false);
  }

  function togglePreview() {
    if (playing) {
      stopPreview();
      return;
    }
    if (!selectedVoice?.previewUrl) return;
    const audio = new Audio(selectedVoice.previewUrl);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  useEffect(() => stopPreview, []); // stop audio when leaving the page

  useEffect(() => {
    listVoices()
      .then((v) => {
        setVoices(v);
        const alice = v.find((voice) => voice.name.toLowerCase().includes('alice'));
        if (alice) setVoiceId(alice.id);
        else if (v.length) setVoiceId(v[0].id);
      })
      .catch(() => setVoices([]));
  }, []);

  const femaleVoices = voices.filter((v) => v.gender === 'female');
  const maleVoices = voices.filter((v) => v.gender === 'male');
  const otherVoices = voices.filter((v) => v.gender !== 'female' && v.gender !== 'male');

  function voiceOption(v: Voice) {
    return {
      value: v.id,
      label: v.name,
      detail: `${v.description}${v.accent ? ` · ${v.accent}` : ''}`,
    };
  }

  const voiceGroups = [
    ...(femaleVoices.length ? [{ label: 'Female', options: femaleVoices.map(voiceOption) }] : []),
    ...(maleVoices.length ? [{ label: 'Male', options: maleVoices.map(voiceOption) }] : []),
    ...(otherVoices.length ? [{ label: 'Other', options: otherVoices.map(voiceOption) }] : []),
  ];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !courseContent.trim()) {
      setError('Please provide both a course title and course content.');
      return;
    }

    setSubmitting(true);
    try {
      await createVideo({
        title,
        courseContent,
        animationStyle,
        quality,
        voiceId: voiceId || undefined,
        targetDurationMinutes,
        contentDepth,
      });
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit video job');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <h1>Course to video. Sorted.</h1>
      <p className="page-subtitle">
        Paste your course content and get a professionally animated, narrated explainer video.
      </p>
      <form className="upload-form" onSubmit={handleSubmit}>
        <label>
          Course Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Intro to Photosynthesis"
            disabled={submitting}
          />
        </label>

        <label>
          Course Content
          <textarea
            value={courseContent}
            onChange={(e) => setCourseContent(e.target.value)}
            placeholder="Paste your course content (markdown or plain text)..."
            rows={14}
            disabled={submitting}
          />
        </label>

        <div className="form-row">
          <label>
            Animation Style
            <AppleSelect
              groups={[{ options: ANIMATION_STYLES.map((s) => ({ value: s, label: s })) }]}
              value={animationStyle}
              onChange={(v) => setAnimationStyle(v as AnimationStyle)}
              disabled={submitting}
            />
          </label>

          <label>
            Video Length
            <AppleSelect
              groups={[{
                options: DURATIONS.map((d) => ({
                  value: String(d.value),
                  label: d.label,
                  detail: `~${d.chars.toLocaleString()} characters`,
                })),
              }]}
              value={String(targetDurationMinutes)}
              onChange={(v) => setTargetDurationMinutes(Number(v))}
              disabled={submitting}
            />
          </label>

          <label>
            Narration Voice
            <div className="voice-row">
              <AppleSelect
                groups={voiceGroups}
                value={voiceId}
                onChange={(v) => {
                  stopPreview();
                  setVoiceId(v);
                }}
                disabled={submitting || !voices.length}
                placeholder="Default voice"
              />
              <button
                type="button"
                className="listen-button"
                onClick={togglePreview}
                disabled={submitting || !selectedVoice?.previewUrl}
                title={playing ? 'Stop preview' : 'Listen to this voice'}
              >
                {playing ? '◼ Stop' : '▶ Listen'}
              </button>
            </div>
          </label>
        </div>

        <fieldset disabled={submitting}>
          <legend>Video Quality</legend>
          {QUALITIES.map((q) => {
            const locked = lockedFor(q);
            const requiredPlan = locked ? planRequiredFor(q) : null;
            return (
              <label key={q} className={`radio-label${locked ? ' radio-label--locked' : ''}`}>
                <input
                  type="radio"
                  name="quality"
                  value={q}
                  checked={quality === q}
                  disabled={locked}
                  onChange={() => setQuality(q)}
                />
                {q}
                {locked && (
                  <span className="field-hint">
                    {' '}
                    — <Link to="/pricing">{requiredPlan ? `requires ${requiredPlan}` : 'upgrade to unlock'}</Link>
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>

        <div className="toggle-row">
          <div>
            <div className="toggle-row__label">Deep Dive</div>
            <div className="field-hint">
              Richer detail, illustrative examples, and a recap quiz — may run longer than your selected length.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={contentDepth === 'deep-dive'}
              disabled={submitting}
              onChange={(e) => setContentDepth(e.target.checked ? 'deep-dive' : 'standard')}
            />
            <span className="switch__track" />
          </label>
        </div>

        {error && <div className="error-text">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Generate Video'}
        </button>
      </form>
    </div>
  );
}
