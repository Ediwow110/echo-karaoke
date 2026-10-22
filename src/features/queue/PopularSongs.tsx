import { useEffect, useState } from 'react';
import { CheckIcon, PlusIcon } from '@phosphor-icons/react';
import { useRoomApi } from '../../app/RoomApiProvider';
import { loadGuestToken } from '../rooms/tokenStore';
import { addSong, type QueueSong } from './queueApi';
import { SongArtwork } from '../../ui';
import type { SearchResult } from '../../types/search';

type PopularResponse = {
  available: boolean;
  results: SearchResult[];
  message?: string;
};

export type PopularSongsProps = {
  roomId: string;
  disabled?: boolean;
  queuedVideoIds?: string[];
  onAdded?: (song: QueueSong) => void;
};

/**
 * The live YouTube music chart, so a guest can queue a song without typing.
 * Without an API key on the server the strip stays hidden.
 */
export default function PopularSongs({ roomId, disabled = false, queuedVideoIds = [], onAdded }: PopularSongsProps) {
  const api = useRoomApi();
  const [songs, setSongs] = useState<SearchResult[]>([]);
  const [queued, setQueued] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const guestToken = loadGuestToken(roomId);
    if (guestToken === null) {
      return;
    }

    void api
      .invoke<PopularResponse>('youtube-popular', { roomId }, { guestToken })
      .then((response) => {
        if (!cancelled && response.available === true) {
          setSongs(response.results ?? []);
        }
      })
      .catch(() => {
        // Search and the paste field below still work without the chart.
      });

    return () => {
      cancelled = true;
    };
  }, [api, roomId]);

  async function queue(videoId: string): Promise<void> {
    if (disabled || queued !== null || queuedVideoIds.includes(videoId) || added.includes(videoId)) {
      return;
    }
    setQueued(videoId);
    setError(null);
    try {
      const song = await addSong(api, roomId, videoId);
      setAdded((current) => [...current, videoId]);
      onAdded?.(song);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That song could not be added.');
    } finally {
      setQueued(null);
    }
  }

  if (songs.length === 0) {
    return null;
  }

  return (
    <div data-suggestions className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-ink-2">Popular now</p>
        <p className="text-[0.625rem] text-ink-3">YouTube chart</p>
      </div>
      <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {songs.slice(0, 8).map((song) => {
          const isQueued = queuedVideoIds.includes(song.videoId) || added.includes(song.videoId);
          const busy = queued === song.videoId;
          return (
            <li key={song.videoId} className="w-[9.75rem] shrink-0">
              <button
                type="button"
                onClick={() => void queue(song.videoId)}
                disabled={disabled || isQueued || queued !== null}
                aria-label={isQueued ? song.title + ' is already queued' : 'Queue ' + song.title}
                className="group w-full overflow-hidden rounded-panel border border-line bg-surface text-left transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:cursor-default disabled:opacity-70"
              >
                <span className="relative block aspect-video w-full overflow-hidden bg-surface-3">
                  <SongArtwork src={song.thumbnailUrl} className="h-full w-full" rounded="none" iconSize={20} />
                  <span className="absolute bottom-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-graphite-deep/85 text-ink">
                    {isQueued ? <CheckIcon size={14} weight="bold" aria-hidden="true" /> : <PlusIcon size={14} weight="bold" aria-hidden="true" />}
                  </span>
                </span>
                <span className="block p-2.5">
                  <span className="block truncate text-[0.75rem] font-semibold text-ink">{song.title}</span>
                  <span className="mt-0.5 block truncate text-[0.625rem] text-ink-2">{busy ? 'Adding…' : song.channelTitle ?? 'YouTube'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error === null ? null : (
        <p role="alert" className="rounded-media border border-danger/30 bg-danger-soft/50 px-3 py-2 text-[0.75rem] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
