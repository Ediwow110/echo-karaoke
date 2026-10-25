import { useCallback, useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import type { EdgeApi } from '../../lib/edgeApi';
import { queueCatalogSong, readCatalogPage, type CatalogSong } from './catalogApi';
import { SongArtwork } from '../../ui';

const PAGE_SIZE = 30;
// The database clamps paging at this offset, so a request past it replays the
// same rows forever. Stop offering Load more before that happens.
const MAX_OFFSET = 5000;

export type SongbookListProps = {
  api: EdgeApi;
  roomId: string;
  // The guest screen and the host page pass the synced channel labels; a
  // caller that omits them gets no chips.
  channels?: { id: string; label: string }[];
  onAdded?: () => void;
};

export default function SongbookList({ api, roomId, channels, onAdded }: SongbookListProps) {
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState('');
  const [items, setItems] = useState<CatalogSong[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Search responses can arrive out of order. Every read owns a sequence number
  // and may only write (and clear `busy`) while it is still the newest one.
  const seq = useRef(0);

  const load = useCallback(async (nextOffset: number, reset: boolean): Promise<void> => {
    const id = ++seq.current;
    setBusy(true);
    try {
      const page = await readCatalogPage(api, roomId, { query, channel, offset: nextOffset, limit: PAGE_SIZE });
      if (seq.current !== id) return;
      setTotal(page.total);
      setOffset(nextOffset);
      setItems((current) => {
        if (reset) return page.items;
        const known = new Set(current.map((song) => song.videoId));
        return [...current, ...page.items.filter((song) => !known.has(song.videoId))];
      });
      setMore(page.items.length >= PAGE_SIZE && nextOffset + PAGE_SIZE <= MAX_OFFSET);
      setHasLoaded(true);
      setError(null);
    } catch (caught) {
      if (seq.current !== id) return;
      setError(caught instanceof Error ? caught.message : 'The songbook could not load.');
    } finally {
      // A superseded read must not re-enable Load more while the newer one runs.
      if (seq.current === id) setBusy(false);
    }
  }, [api, channel, query, roomId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(0, true); }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function add(song: CatalogSong): Promise<void> {
    setAdding(song.videoId);
    try {
      await queueCatalogSong(api, roomId, song.videoId);
      setAdded((current) => [...current, song.videoId]);
      onAdded?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That song could not be added.');
    } finally {
      setAdding(null);
    }
  }

  const loadingFirstPage = hasLoaded === false && error === null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Search the songbook</span>
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute left-3 text-ink-3" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or artist"
            className="min-h-11 w-full rounded-media border border-line bg-surface pl-9 pr-3 text-[0.8125rem] text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          />
        </label>
        <p role="status" className="text-[0.6875rem] text-ink-2">{hasLoaded ? total + ' songs' : ''}</p>
      </div>

      {channels === undefined || channels.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setChannel('')}
            aria-pressed={channel === ''}
            className={['min-h-11 min-w-11 rounded-pill border px-3 text-[0.6875rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
              channel === '' ? 'border-signal/40 bg-signal-soft text-signal' : 'border-line bg-surface text-ink-2 hover:text-ink'].join(' ')}
          >
            All
          </button>
          {channels.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setChannel(entry.id)}
              aria-pressed={channel === entry.id}
              className={['min-h-11 min-w-11 rounded-pill border px-3 text-[0.6875rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                channel === entry.id ? 'border-signal/40 bg-signal-soft text-signal' : 'border-line bg-surface text-ink-2 hover:text-ink'].join(' ')}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {error === null ? null : <p role="alert" className="text-[0.75rem] text-danger">{error}</p>}

      {loadingFirstPage ? (
        <div className="py-6 text-center">
          <p className="text-[0.8125rem] text-ink-2" aria-hidden="true">Loading the songbook…</p>
          <span role="status" aria-label="Loading the songbook…" className="sr-only">Loading the songbook…</span>
        </div>
      ) : hasLoaded === false ? null : items.length === 0 && busy === false ? (
        <p className="rounded-panel border border-line bg-surface px-4 py-6 text-center text-[0.8125rem] text-ink-2">
          {total === 0
            ? 'The songbook is warming up. Ask the host to refresh it.'
            : 'No song matches that search.'}
        </p>
      ) : (
        // Refetches keep the rows already on screen and mark them busy instead
        // of flashing an empty list.
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Songbook songs" aria-busy={busy}>
          {items.map((song) => {
            const isAdded = added.includes(song.videoId);
            return (
              <li key={song.videoId}>
                <div className="flex flex-wrap items-center gap-3 gap-y-2 rounded-panel border border-line bg-surface p-2">
                  <SongArtwork src={song.thumbnailUrl} className="h-12 w-16 shrink-0" iconSize={16} />
                  <div className="min-w-16 flex-1">
                    <p className="truncate text-[0.8125rem] font-semibold text-ink">{song.title}</p>
                    <p className="truncate text-[0.6875rem] text-ink-2">{song.channelTitle ?? 'YouTube'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void add(song)}
                    disabled={isAdded || adding !== null}
                    aria-label={isAdded ? song.title + ' is already queued' : 'Add ' + song.title}
                    className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink transition-[background-color,color,transform,scale] active:scale-95 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45"
                  >
                    <PlusIcon size={15} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasLoaded && more && items.length < total ? (
        <button
          type="button"
          onClick={() => void load(offset + PAGE_SIZE, false)}
          disabled={busy}
          className="min-h-11 rounded-media border border-line bg-surface text-[0.8125rem] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
