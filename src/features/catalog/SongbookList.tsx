import { useCallback, useEffect, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import type { EdgeApi } from '../../lib/edgeApi';
import { queueCatalogSong, readCatalogPage, type CatalogSong } from './catalogApi';
import { SongArtwork } from '../../ui';

const PAGE_SIZE = 30;

export type SongbookListProps = {
  api: EdgeApi;
  roomId: string;
  // The channel chips arrive with the guest screen; the host already passes the
  // labels so the prop shape is settled here.
  channels?: { id: string; label: string }[];
  onAdded?: () => void;
};

export default function SongbookList({ api, roomId, onAdded }: SongbookListProps) {
  const [query, setQuery] = useState('');
  // The channel filter is wired through the request now; Task 5 adds the chips
  // and the setter that drives it.
  const [channel] = useState('');
  const [items, setItems] = useState<CatalogSong[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, reset: boolean): Promise<void> => {
    setBusy(true);
    try {
      const page = await readCatalogPage(api, roomId, { query, channel, offset: nextOffset, limit: PAGE_SIZE });
      setTotal(page.total);
      setOffset(nextOffset);
      setItems((current) => (reset ? page.items : [...current, ...page.items]));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The songbook could not load.');
    } finally {
      setBusy(false);
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
        <p className="text-[0.6875rem] text-ink-2">{total} songs</p>
      </div>

      {error === null ? null : <p role="alert" className="text-[0.75rem] text-danger">{error}</p>}

      {items.length === 0 && busy === false ? (
        <p className="rounded-panel border border-line bg-surface px-4 py-6 text-center text-[0.8125rem] text-ink-2">
          The songbook is warming up. {total === 0 ? 'Ask the host to refresh it.' : 'No song matches that search.'}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Songbook songs">
          {items.map((song) => {
            const isAdded = added.includes(song.videoId);
            return (
              <li key={song.videoId}>
                <div className="flex items-center gap-3 rounded-panel border border-line bg-surface p-2">
                  <SongArtwork src={song.thumbnailUrl} className="h-12 w-16 shrink-0" iconSize={16} />
                  <div className="min-w-0 flex-1">
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

      {items.length < total ? (
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
