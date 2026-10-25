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
  layout?: 'horizontal' | 'vertical';
  disabled?: boolean;
  queuedVideoIds?: string[];
  moreHref?: string;
  onAdded?: (song: QueueSong) => void;
};

/**
 * The live YouTube music chart, so a guest can queue a song without typing.
 * Without an API key on the server the strip stays hidden.
 */
export default function PopularSongs({ roomId, layout = 'horizontal', disabled = false, queuedVideoIds = [], moreHref, onAdded }: PopularSongsProps) {
  const api = useRoomApi();
  const [songs, setSongs] = useState<SearchResult[]>([]);
  const [queued, setQueued] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [canPrevious, setCanPrevious] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setSongs([]);
    const guestToken = loadGuestToken(roomId);
    const hostToken = loadHostToken(roomId);
    const tokens = guestToken !== null ? { guestToken } : hostToken !== null ? { hostToken } : null;
    if (tokens === null) {
      setLoadState('unavailable');
      return;
    }

    void api
      .invoke<PopularResponse>('youtube-popular', { roomId }, tokens)
      .then((response) => {
        if (!cancelled) {
          setSongs(response.available === true ? response.results ?? [] : []);
          setLoadState(response.available === true ? 'ready' : 'unavailable');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSongs([]);
          setLoadState('error');
        }
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
    // The guest's optional horizontal carousel can disappear as before, but
    // the host's vertical discovery panel must explain its real data state.
    if (layout === 'horizontal') return null;
    return (
      <section data-suggestions data-layout="vertical" aria-label="Popular karaoke">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow text-ink-2">Popular karaoke</p>
          {moreHref === undefined ? null : (
            <Link to={moreHref} className="inline-flex min-h-11 items-center text-[0.6875rem] font-semibold text-signal hover:underline">
              Browse the songbook
            </Link>
          )}
        </div>
        <p role="status" className="mt-3 rounded-media border border-line bg-surface-2 px-4 py-4 text-[0.75rem] leading-[1.6] text-ink-2">
          {loadState === 'loading'
            ? 'Loading popular karaoke suggestions…'
            : loadState === 'error'
              ? 'Popular suggestions could not be loaded. Search for a song or try the songbook.'
              : loadState === 'unavailable'
                ? 'Popular suggestions are unavailable right now. Search for a song or browse the songbook.'
                : 'No popular songs to suggest right now. Try searching for a song.'}
        </p>
      </section>
    );
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
      <ul id={listId} ref={listRef} aria-label="Popular karaoke songs" data-layout={layout} tabIndex={layout === 'vertical' ? 0 : undefined} className={layout === 'vertical'
        ? 'flex max-h-[27rem] flex-col gap-2 overflow-y-auto overscroll-contain rounded-media pr-2 focus-visible:outline-2 focus-visible:outline-signal'
        : 'no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-1'}>
        {songs.slice(0, 8).map((song) => {
          const isQueued = queuedVideoIds.includes(song.videoId) || added.includes(song.videoId);
          const busy = queued === song.videoId;
          return (
            <li key={song.videoId} className={layout === 'vertical' ? 'w-full min-w-0' : 'w-[9.75rem] shrink-0'}>
              <button
                type="button"
                onClick={() => void queue(song.videoId)}
                disabled={disabled || isQueued || queued !== null}
                aria-label={isQueued ? song.title + ' is already queued' : 'Queue ' + song.title}
                className={['group w-full overflow-hidden rounded-panel border border-line bg-surface text-left transition-[border-color,translate,scale] duration-200 hover:border-line-strong active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-70', layout === 'vertical' ? 'flex items-center gap-3 p-2' : ''].join(' ')}
              >
                <span className={layout === 'vertical' ? 'relative block h-[4.5rem] w-32 shrink-0 overflow-hidden rounded-media bg-surface-3' : 'relative block aspect-video w-full overflow-hidden bg-surface-3'}>
                  <SongArtwork src={song.thumbnailUrl} className="h-full w-full" rounded="none" iconSize={20} />
                  <span className="absolute bottom-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-graphite-deep/85 text-ink">
                    {isQueued ? <CheckIcon size={14} weight="bold" aria-hidden="true" /> : <PlusIcon size={14} weight="bold" aria-hidden="true" />}
                  </span>
                </span>
                <span className={layout === 'vertical' ? 'block min-w-0 flex-1 p-1' : 'block p-2.5'}>
                  <span className="block truncate text-[0.75rem] font-semibold text-ink">{song.title}</span>
                  <span className="mt-0.5 block truncate text-[0.625rem] text-ink-2">{busy ? 'Adding…' : song.channelTitle ?? 'YouTube'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {layout === 'horizontal' && overflowing ? (
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
