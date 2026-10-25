import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { useRoomApi } from '../../app/RoomApiProvider';
import { loadGuestToken, loadHostToken } from '../rooms/tokenStore';
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
  moreHref?: string;
  onAdded?: (song: QueueSong) => void;
};

/**
 * The live YouTube music chart, so a guest can queue a song without typing.
 * Without an API key on the server the strip stays hidden.
 */
export default function PopularSongs({ roomId, disabled = false, queuedVideoIds = [], moreHref, onAdded }: PopularSongsProps) {
  const api = useRoomApi();
  const [songs, setSongs] = useState<SearchResult[]>([]);
  const [queued, setQueued] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [canPrevious, setCanPrevious] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    const guestToken = loadGuestToken(roomId);
    const hostToken = loadHostToken(roomId);
    const tokens = guestToken !== null ? { guestToken } : hostToken !== null ? { hostToken } : null;
    if (tokens === null) {
      return;
    }

    void api
      .invoke<PopularResponse>('youtube-popular', { roomId }, tokens)
      .then((response) => {
        if (!cancelled && response.available === true) {
          setSongs(response.results ?? []);
        }
      })
      .catch(() => {
        // The chart is optional; search and the library still work without it.
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

  const measure = useCallback((): void => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const max = list.scrollWidth - list.clientWidth;
    setOverflowing(max > 2);
    setCanPrevious(list.scrollLeft > 2);
    setCanNext(list.scrollLeft < max - 2);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    measure();
    list.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(list);
    return () => {
      list.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure, songs.length]);

  const slide = useCallback((direction: -1 | 1): void => {
    const list = listRef.current;
    if (list === null || typeof list.scrollBy !== 'function') {
      return;
    }
    const first = list.firstElementChild as HTMLElement | null;
    const second = list.children[1] as HTMLElement | null;
    const pitch = first !== null && second !== null
      ? second.offsetLeft - first.offsetLeft
      : first?.getBoundingClientRect().width ?? 0;
    if (pitch <= 0) {
      return;
    }
    const perPage = Math.max(1, Math.floor(list.clientWidth / pitch));
    const reduce = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollBy({ left: direction * perPage * pitch, behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  if (songs.length === 0) {
    return null;
  }

  return (
    <div data-suggestions className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-ink-2">Popular karaoke</p>
        {moreHref === undefined ? (
          <p className="text-[0.625rem] text-ink-3">With lyrics</p>
        ) : (
          <Link to={moreHref} className="inline-flex min-h-11 items-center text-[0.6875rem] font-semibold text-signal hover:underline">
            View more
          </Link>
        )}
      </div>
      <div className="relative">
      <ul id={listId} ref={listRef} aria-label="Popular karaoke songs" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-1">
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
                className="group w-full overflow-hidden rounded-panel border border-line bg-surface text-left transition-[border-color,translate,scale] duration-200 hover:-translate-y-0.5 hover:border-line-strong active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-70"
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
      {overflowing ? (
        <>
          <button
            type="button"
            onClick={() => slide(-1)}
            disabled={!canPrevious}
            aria-label="Previous popular karaoke songs"
            aria-controls={listId}
            className="absolute left-0 top-4 z-10 grid size-11 place-items-center rounded-full border border-line bg-graphite-deep/90 text-ink shadow-lg backdrop-blur transition-[opacity,scale] duration-200 hover:border-line-strong active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => slide(1)}
            disabled={!canNext}
            aria-label="Next popular karaoke songs"
            aria-controls={listId}
            className="absolute right-0 top-4 z-10 grid size-11 place-items-center rounded-full border border-line bg-graphite-deep/90 text-ink shadow-lg backdrop-blur transition-[opacity,scale] duration-200 hover:border-line-strong active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowRightIcon size={16} weight="bold" aria-hidden="true" />
          </button>
        </>
      ) : null}
      </div>
      {error === null ? null : (
        <p role="alert" className="rounded-media border border-danger/30 bg-danger-soft/50 px-3 py-2 text-[0.75rem] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
