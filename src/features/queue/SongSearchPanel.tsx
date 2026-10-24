import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { QueueEntry } from '../rooms/useRoomData';
import type { QueueSong } from './queueApi';
import { useSongSearch } from './useSongSearch';
import { formatTime } from '../../lib/format';
import { Button, SongArtwork } from '../../ui';

export type SongSearchPanelProps = {
  roomId: string;
  queue: QueueEntry[];
  disabled?: boolean;
  variant?: 'host' | 'guest';
  initialQuery?: string;
  autoFocus?: boolean;
  onAdded?: (song: QueueSong) => void;
  onOpenQueue?: () => void;
  popularSlot?: ReactNode;
  className?: string;
};

const exampleSearches = ['The Weeknd karaoke', '80s sing-alongs', 'M83 karaoke'];

export default function SongSearchPanel({
  roomId,
  queue,
  disabled = false,
  variant = 'guest',
  initialQuery = '',
  autoFocus = false,
  onAdded,
  onOpenQueue,
  popularSlot,
  className = '',
}: SongSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fallbackInputId = useId();
  const [link, setLink] = useState('');
  const {
    query,
    setQuery,
    results,
    loading,
    searched,
    available,
    searchBlocked,
    message,
    error,
    addingId,
    addError,
    addedIds,
    notice,
    submit,
    add,
    addByLink,
    clear,
    resetNotice,
    clearAddError,
    retry,
  } = useSongSearch({ roomId, initialQuery, disabled, onAdded });
  const showLinkFallback = available === false || searchBlocked;

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = window.setTimeout(resetNotice, 6000);
    return () => window.clearTimeout(timer);
  }, [notice, resetNotice]);

  const queuedFor = (videoId: string): QueueEntry | undefined => queue.find((song) => song.videoId === videoId);
  // The Up next lists number only queued songs, with the current song separate.
  // Use the same frame here so one song never shows two different numbers.
  const upNext = queue.filter((song) => song.status !== 'playing');
  const queueIndex = (videoId: string): number | null => {
    const index = upNext.findIndex((song) => song.videoId === videoId);
    return index < 0 ? null : index + 1;
  };
  const noticeIndex = notice === null ? null : queueIndex(notice.videoId);

  return (
    <div className={['flex flex-col gap-4', className].join(' ')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        role="search"
      >
        <label htmlFor="song-search" className="sr-only">Find a song on YouTube</label>
        <div className="relative">
          <MagnifyingGlassIcon
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-2"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            id="song-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search YouTube by song or artist"
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            aria-describedby={error === null ? undefined : 'song-search-error'}
            className="min-h-12 w-full rounded-media border border-line bg-surface pl-11 pr-14 text-[0.875rem] text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          />
          {query.length > 0 ? (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <XIcon size={15} weight="bold" aria-hidden="true" />
            </button>
          ) : (
            <span aria-hidden="true" className="absolute right-4 top-1/2 hidden -translate-y-1/2 text-[0.625rem] text-ink-3 sm:block">
              Enter
            </span>
          )}
        </div>
      </form>

      {error !== null ? (
        <div id="song-search-error" role="alert" className="flex items-start justify-between gap-3 rounded-media border border-danger/30 bg-danger-soft/50 px-3.5 py-3 text-[0.75rem] leading-[1.5] text-danger">
          <span>{error}</span>
          <button type="button" onClick={retry} className="inline-flex min-h-11 shrink-0 items-center px-2 font-semibold underline underline-offset-2">Retry</button>
        </div>
      ) : null}

      {available === false && message !== null ? (
        <div role="status" className="rounded-media border border-line bg-surface-2 px-4 py-3 text-[0.75rem] leading-[1.6] text-ink-2">
          {message}
        </div>
      ) : null}

      {showLinkFallback ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addByLink(link).then((added) => {
              if (added) setLink('');
            });
          }}
          aria-label="Add a song by YouTube link"
          className="rounded-media border border-line bg-surface-2 px-3.5 py-3"
        >
          <label htmlFor={fallbackInputId} className="text-[0.75rem] font-semibold text-ink">
            Add by YouTube link
          </label>
          <p className="mt-1 text-[0.6875rem] leading-[1.5] text-ink-2">
            Search is unavailable or at its limit. Paste a YouTube link or video ID to keep the queue moving.
          </p>
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
            <input
              id={fallbackInputId}
              type="text"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://youtu.be/..."
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              disabled={disabled}
              className="min-h-11 min-w-0 flex-1 rounded-media border border-line bg-surface px-3 text-[0.8125rem] text-ink placeholder:text-ink-3 focus:border-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-45"
            />
            <Button
              type="submit"
              size="md"
              className="min-h-11 shrink-0"
              busy={addingId !== null}
              disabled={disabled || addingId !== null || link.trim().length === 0}
            >
              Add link
            </Button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <SearchSkeleton variant={variant} />
      ) : null}

      {!loading && results.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="eyebrow text-ink-2">YouTube results</p>
            <p className="text-[0.625rem] text-ink-3">Live search</p>
          </div>
          <ul aria-label="Songs" className="flex flex-col gap-1">
            {results.map((result, index) => {
              const queued = queuedFor(result.videoId);
              const added = queued !== undefined || addedIds.includes(result.videoId);
              const pending = addingId === result.videoId;
              return (
                <li
                  key={result.videoId}
                  className={[
                    'stagger-in flex flex-wrap items-center gap-3 gap-y-2 rounded-media px-1 py-2.5 transition-colors',
                    variant === 'guest' ? 'border-b border-line last:border-b-0' : 'hover:bg-surface-2',
                  ].join(' ')}
                  style={{ animationDelay: Math.min(index, 10) * 30 + 'ms' }}
                >
                  <div className="relative shrink-0">
                    <SongArtwork
                      src={result.thumbnailUrl}
                      className={variant === 'guest' ? 'h-[3.7rem] w-[5.5rem]' : 'h-11 w-[4.15rem]'}
                      iconSize={18}
                    />
                    {result.durationSeconds === null ? null : (
                      <span className="absolute bottom-1 right-1 rounded bg-graphite-deep/80 px-1 py-0.5 text-[0.5625rem] tabular text-ink">
                        {formatTime(result.durationSeconds)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={['truncate text-[0.8125rem] font-semibold leading-[1.4]', added ? 'text-signal' : 'text-ink'].join(' ')}>
                      {result.title}
                    </p>
                    <p className="mt-0.5 truncate text-[0.6875rem] text-ink-2">
                      {result.channelTitle ?? 'YouTube'}
                    </p>
                    {queued === undefined ? null : (
                      <p className="mt-0.5 text-[0.625rem] text-signal">
                        Already in queue{queueIndex(result.videoId) === null ? '' : ' · #' + queueIndex(result.videoId)}
                      </p>
                    )}
                  </div>
                  <Button
                    variant={added ? 'secondary' : 'primary'}
                    size="md"
                    className={['min-h-11', variant === 'guest' ? 'min-w-[4.3rem]' : ''].join(' ')}
                    icon={added ? <CheckIcon size={14} weight="bold" /> : <PlusIcon size={14} weight="bold" />}
                    aria-label={added ? result.title + ' is already in the queue' : pending ? 'Adding ' + result.title : 'Add ' + result.title}
                    disabled={disabled || added || (addingId !== null && !pending)}
                    busy={pending}
                    onClick={() => {
                      if (!added) {
                        void add(result);
                      }
                    }}
                  >
                    {pending ? 'Adding' : added ? 'Added' : 'Add'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!loading && searched && results.length === 0 && error === null && available !== false ? (
        <div className="rounded-panel border border-line bg-surface px-5 py-7 text-center">
          <span aria-hidden="true" className="mx-auto grid size-10 place-items-center rounded-full bg-surface-2 text-ink-2">
            <MagnifyingGlassIcon size={18} />
          </span>
          <h3 className="mt-3 font-display text-[1.25rem] font-bold tracking-[-0.02em] text-ink">No matches this time.</h3>
          <p className="mx-auto mt-1.5 max-w-[34ch] text-[0.75rem] leading-[1.6] text-ink-2">
            No YouTube results for “{query.trim()}”. Try a shorter title, or add “karaoke”.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" className="min-h-11" onClick={() => inputRef.current?.focus()}>Edit search</Button>
            <Button variant="ghost" size="sm" className="min-h-11" onClick={clear}>Clear search</Button>
          </div>
        </div>
      ) : null}

      {!loading && !searched && error === null ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.625rem] font-medium uppercase tracking-[0.06em] text-ink-3">Try</span>
            {exampleSearches.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuery(example)}
                className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface-2 px-3 text-[0.6875rem] text-ink-2 transition-colors hover:border-signal/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                {example}
              </button>
            ))}
          </div>
          {popularSlot}
        </>
      ) : null}

      {addError !== null ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-media border border-danger/30 bg-danger-soft/50 px-3.5 py-3 text-[0.75rem] leading-[1.5] text-danger">
          <span>{addError}</span>
          <button type="button" onClick={clearAddError} aria-label="Dismiss" className="grid size-11 shrink-0 place-items-center rounded-full text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal">
            <XIcon size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {notice !== null ? (
        <div role="status" className="flex items-center gap-3 rounded-panel border border-signal/25 bg-signal-soft px-4 py-3 animate-console-in">
          <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-signal" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.75rem] font-semibold text-ink">{notice.title} added</p>
            <p className="mt-0.5 text-[0.6875rem] text-ink-2">
              {noticeIndex === null ? 'In the queue' : '#' + noticeIndex + ' in the queue'} · Added by you
            </p>
          </div>
          {onOpenQueue === undefined ? null : (
            <button
              type="button"
              onClick={() => {
                onOpenQueue();
                resetNotice();
              }}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[0.6875rem] font-semibold text-signal hover:underline"
            >
              Queue <ArrowRightIcon size={12} weight="bold" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={resetNotice}
            aria-label="Dismiss"
            className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink"
          >
            <XIcon size={13} weight="bold" aria-hidden="true" />
          </button>
        </div>
      ) : null}

    </div>
  );
}

function SearchSkeleton({ variant }: { variant: 'host' | 'guest' }) {
  return (
    <div aria-label="Searching YouTube" role="status" className="flex flex-col gap-1">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-3 py-2.5">
          <div className={['skeleton shrink-0 rounded-media', variant === 'guest' ? 'h-[3.7rem] w-[5.5rem]' : 'h-11 w-[4.15rem]'].join(' ')} />
          <div className="flex-1">
            <div className="skeleton h-3 w-2/3 rounded" />
            <div className="skeleton mt-2 h-2.5 w-1/3 rounded" />
          </div>
          <div className="skeleton h-8 w-16 rounded-media" />
        </div>
      ))}
      <p className="mt-1 flex items-center gap-2 text-[0.6875rem] text-ink-2">
        <ArrowClockwiseIcon size={13} className="animate-spin" aria-hidden="true" />
        Searching YouTube…
      </p>
    </div>
  );
}
