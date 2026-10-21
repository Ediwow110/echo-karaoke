import { useEffect, useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { useRoomApi } from '../../app/RoomApiProvider';
import { loadGuestToken } from '../rooms/tokenStore';
import { addSong } from './queueApi';
import type { SearchResult } from '../../types/search';

type PopularResponse = {
  available: boolean;
  results: SearchResult[];
  message?: string;
};

export type PopularSongsProps = {
  roomId: string;
  onAdded?: () => void;
};

/**
 * The live list of songs a guest can queue without typing. The list comes from
 * the YouTube music chart, so it needs a data key on the server. Without the
 * key the strip stays hidden and the search field below it carries on.
 */
export default function PopularSongs({ roomId, onAdded }: PopularSongsProps) {
  const api = useRoomApi();
  const [songs, setSongs] = useState<SearchResult[]>([]);
  const [queued, setQueued] = useState<string | null>(null);

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
        // The search field below the strip is always there.
      });

    return () => {
      cancelled = true;
    };
  }, [api, roomId]);

  async function queue(videoId: string): Promise<void> {
    setQueued(videoId);
    try {
      await addSong(api, roomId, videoId);
      onAdded?.();
    } catch {
      // The notice in the search panel explains a failure.
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
        <h3 className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ink-3">Popular now</h3>
      </div>
      <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {songs.map((song) => (
          <li key={song.videoId} className="w-[10.5rem] shrink-0">
            <button
              type="button"
              onClick={() => void queue(song.videoId)}
              disabled={queued !== null}
              aria-label={'Queue ' + song.title}
              className="group w-full overflow-hidden rounded-panel border border-line bg-surface-2 text-left transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
            >
              <span className="relative block aspect-video w-full overflow-hidden bg-surface-3">
                {song.thumbnailUrl !== null ? (
                  <img className="h-full w-full object-cover" src={song.thumbnailUrl} alt="" width={168} height={94} loading="lazy" />
                ) : null}
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-graphite/85 text-ink opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100"
                >
                  <PlusIcon size={16} weight="bold" />
                </span>
              </span>
              <span className="block p-2">
                <span className="block truncate text-[0.8125rem] font-semibold text-ink">{song.title}</span>
                <span className="block truncate text-[0.75rem] text-ink-3">{song.channelTitle ?? 'YouTube'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
