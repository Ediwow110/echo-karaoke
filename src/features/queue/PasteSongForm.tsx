import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRightIcon, LinkIcon, PlusIcon } from '@phosphor-icons/react';
import { RoomApiError } from '../../lib/edgeApi';
import { parseYouTubeVideoId } from './youtubeVideo';
import { addSong, type QueueSong } from './queueApi';
import { scrollToQueue } from './queueAnchor';
import { useRoomApi } from '../../app/RoomApiProvider';
import { Button } from '../../ui';

type Props = {
  roomId: string;
  disabled?: boolean;
  onAdded?: (song: QueueSong) => void;
  onViewQueue?: () => void;
  queuedVideoIds?: string[];
  compact?: boolean;
};

function describeError(error: unknown): string {
  if (error instanceof RoomApiError) {
    if (error.code === 'RATE_LIMITED') return 'That is five songs this minute. Wait a moment.';
    if (error.code === 'GUEST_CONTROLS_LOCKED') return 'The host turned off guest requests.';
    if (error.code === 'METADATA_UNAVAILABLE') return 'That video could not be read. Check the link.';
    if (error.code === 'DUPLICATE_SONG') return 'That song is already in the queue.';
    if (error.code === 'ROOM_ENDED') return 'This room has ended.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'That song could not be added.';
}

export default function PasteSongForm({ roomId, disabled = false, onAdded, onViewQueue, queuedVideoIds = [], compact = false }: Props) {
  const api = useRoomApi();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const videoId = parseYouTubeVideoId(value);
    if (videoId === null) {
      setError('Paste a YouTube link or an eleven character video id.');
      return;
    }
    if (queuedVideoIds.includes(videoId)) {
      setError('That song is already in the queue.');
      return;
    }

    setBusy(true);
    try {
      const song = await addSong(api, roomId, videoId);
      setValue('');
      setNotice(song.title + ' is in the queue');
      onAdded?.(song);
      if (onViewQueue === undefined) {
        scrollToQueue();
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Add a song by link">
      <label htmlFor="song-link" className="text-[0.75rem] font-semibold text-ink">Paste a YouTube link</label>
      <div className={compact ? 'mt-2 flex flex-col gap-2 sm:flex-row' : 'mt-2'}>
        <div className="relative flex-1">
          <LinkIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-2" aria-hidden="true" />
          <input
            id="song-link"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://youtu.be/…"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={error === null ? undefined : 'true'}
            aria-describedby={error === null ? undefined : 'song-link-error'}
            className="min-h-11 w-full rounded-media border border-line bg-surface pl-10 pr-3.5 text-[0.8125rem] text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-signal focus:outline-none disabled:opacity-50"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="md"
          icon={<PlusIcon size={15} weight="bold" />}
          disabled={disabled || busy}
          busy={busy}
          className={compact ? 'shrink-0' : 'mt-3'}
        >
          {busy ? 'Adding' : 'Add to queue'}
        </Button>
      </div>
      {error === null ? null : (
        <p id="song-link-error" role="alert" className="mt-2 text-[0.75rem] text-danger">{error}</p>
      )}
      {notice === null ? null : (
        <div role="status" className="mt-2 rounded-media border border-signal/20 bg-signal-soft/40 px-3 py-2 text-[0.6875rem] leading-[1.5] text-ink-2">
          <p className="line-clamp-2">{notice}</p>
          {onViewQueue === undefined ? null : (
            <button type="button" onClick={onViewQueue} className="mt-1 inline-flex items-center gap-1 font-semibold text-signal hover:underline">
              View queue <ArrowRightIcon size={12} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </form>
  );
}
