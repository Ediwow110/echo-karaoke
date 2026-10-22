import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRightIcon,
  CheckIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  MusicNotesIcon,
  PlusIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import { useRoomApi } from '../../app/RoomApiProvider';
import { addSong } from '../queue/queueApi';
import {
  getFavoriteIds,
  toggleFavorite,
  type LibrarySong,
  type RecentSong,
} from './libraryStore';
import { useFavoriteSongs, useLibrarySongs, useRecentSongs } from './useLibrary';
import { formatTime } from '../../lib/format';
import { Button, EmptyState, SongArtwork, Toast, type ToastTone } from '../../ui';

export type CollectionMode = 'library' | 'favorites' | 'recent';

type Props = {
  mode: CollectionMode;
  roomId?: string | null;
  queueHref?: string | null;
  searchHref?: string | null;
  onAdded?: () => void;
  heading?: string;
};

const copy: Record<CollectionMode, { eyebrow: string; title: string; description: string; emptyTitle: string; emptyBody: string }> = {
  library: {
    eyebrow: 'Your collection',
    title: 'Every song worth another round.',
    description: 'Songs this browser has seen in your rooms, ready to bring back.',
    emptyTitle: 'Your library is warming up.',
    emptyBody: 'Songs appear here as you add them to a room. Start a session and search YouTube.',
  },
  favorites: {
    eyebrow: 'Your collection',
    title: 'The songs you come back to.',
    description: 'Save the YouTube versions you love and bring them into the next room.',
    emptyTitle: 'No favorites yet.',
    emptyBody: 'Tap the heart on a song in the queue or library and it will wait for you here.',
  },
  recent: {
    eyebrow: 'Your collection',
    title: 'What the room sang last.',
    description: 'A local history of songs that played on your host screen.',
    emptyTitle: 'No songs sung yet.',
    emptyBody: 'Start a room, add a song, and the ones that play will be remembered here.',
  },
};

function formatPlayedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SongCollectionView({ mode, roomId = null, queueHref = null, searchHref = null, onAdded, heading }: Props) {
  const api = useRoomApi();
  const navigate = useNavigate();
  const library = useLibrarySongs();
  const favorites = useFavoriteSongs();
  const recent = useRecentSongs();
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [toast, setToast] = useState<{ id: number; message: string; detail?: string; tone: ToastTone } | null>(null);

  const songs: LibrarySong[] = mode === 'favorites' ? favorites : mode === 'library' ? library : recent;
  const favoriteIds = new Set(getFavoriteIds());
  const meta = copy[mode];

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (term.length === 0) {
      return songs;
    }
    return songs.filter((song) => (song.title + ' ' + (song.channelTitle ?? '')).toLowerCase().includes(term));
  }, [filter, songs]);

  async function add(song: LibrarySong): Promise<void> {
    if (roomId === null || adding !== null || added.includes(song.videoId)) {
      return;
    }
    setAdding(song.videoId);
    try {
      await addSong(api, roomId, song.videoId);
      setAdded((current) => [...current, song.videoId]);
      setToast({ id: Date.now(), message: song.title + ' added.', detail: queueHref === null ? undefined : 'Open the queue to see it in the running order.', tone: 'success' });
      onAdded?.();
    } catch (caught) {
      setToast({
        id: Date.now(),
        message: 'That song could not be added.',
        detail: caught instanceof Error ? caught.message : undefined,
        tone: 'error',
      });
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-gold">{meta.eyebrow}</p>
          <h2 className="mt-1 font-display text-[clamp(1.9rem,2.8vw,2.15rem)] font-bold leading-[1.08] tracking-[-0.03em] text-ink">
            {heading ?? meta.title}
          </h2>
          <p className="mt-2 max-w-[56ch] text-[0.8125rem] leading-[1.65] text-ink-2">{meta.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[0.6875rem] text-ink-2">{songs.length} {songs.length === 1 ? 'song' : 'songs'}</span>
          {queueHref === null ? null : (
            <Link to={queueHref} className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-signal hover:underline">
              Room queue <ArrowRightIcon size={11} weight="bold" aria-hidden="true" />
            </Link>
          )}
        </div>
      </header>

      {songs.length > 0 ? (
        <div className="relative max-w-[26rem]">
          <label htmlFor={'collection-search-' + mode} className="sr-only">Search your collection</label>
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-2" aria-hidden="true" />
          <input
            id={'collection-search-' + mode}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search your collection…"
            className="min-h-11 w-full rounded-media border border-line bg-surface pl-10 pr-3.5 text-[0.8125rem] text-ink placeholder:text-ink-3 focus:border-signal focus:outline-none"
          />
        </div>
      ) : null}

      {songs.length === 0 ? (
        <EmptyState
          icon={<MusicNotesIcon size={20} weight="duotone" />}
          title={meta.emptyTitle}
          description={meta.emptyBody}
          action={(
            <Button variant="primary" size="sm" onClick={() => navigate(searchHref ?? '/')}>
              {searchHref === null ? 'Start a room' : 'Find a song'}
            </Button>
          )}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<MagnifyingGlassIcon size={20} />}
          title="No saved songs match."
          description={'Nothing in your ' + mode + ' matches “' + filter.trim() + '”. Try a shorter search.'}
          action={<Button variant="secondary" size="sm" onClick={() => setFilter('')}>Clear search</Button>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={meta.title}>
          {filtered.map((song) => {
            const saved = favoriteIds.has(song.videoId);
            const isAdded = added.includes(song.videoId);
            const played = 'playedAt' in song ? (song as RecentSong).playedAt : null;
            return (
              <li key={song.videoId} className="group flex min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-surface transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong">
                <div className="relative">
                  <SongArtwork src={song.thumbnailUrl} className="aspect-video w-full" rounded="none" iconSize={28} />
                  {song.durationSeconds === null ? null : (
                    <span className="absolute bottom-2 right-2 rounded bg-graphite-deep/80 px-1.5 py-0.5 text-[0.625rem] tabular text-ink">
                      {formatTime(song.durationSeconds)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleFavorite(song)}
                    aria-label={saved ? 'Remove ' + song.title + ' from favorites' : 'Save ' + song.title + ' to favorites'}
                    aria-pressed={saved}
                    className={[
                      'absolute right-2 top-2 grid size-8 place-items-center rounded-full backdrop-blur transition-colors',
                      saved ? 'bg-signal text-signal-ink' : 'bg-graphite-deep/65 text-ink hover:bg-graphite-deep/85',
                    ].join(' ')}
                  >
                    <HeartIcon size={15} weight={saved ? 'fill' : 'regular'} aria-hidden="true" />
                  </button>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="truncate text-[0.875rem] font-semibold text-ink">{song.title}</p>
                  <p className="mt-0.5 truncate text-[0.6875rem] text-ink-2">{song.channelTitle ?? 'YouTube'}</p>
                  {played === null ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-[0.625rem] text-ink-3">
                      <SparkleIcon size={12} aria-hidden="true" />
                      Saved in your library
                    </p>
                  ) : (
                    <p className="mt-2 text-[0.625rem] text-ink-3">Last sung {formatPlayedAt(played)}</p>
                  )}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-[0.625rem] text-ink-3">{saved ? 'Favorite' : 'YouTube reference'}</span>
                    {roomId === null ? (
                      <Link to="/" className="text-[0.6875rem] font-semibold text-signal hover:underline">Create a room</Link>
                    ) : (
                      <Button
                        variant={isAdded ? 'secondary' : 'primary'}
                        size="sm"
                        icon={isAdded ? <CheckIcon size={13} weight="bold" /> : <PlusIcon size={13} weight="bold" />}
                        disabled={adding !== null || isAdded}
                        busy={adding === song.videoId}
                        onClick={() => void add(song)}
                      >
                        {isAdded ? 'Added' : 'Add to room'}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {toast === null ? null : (
        <div className="pointer-events-none fixed inset-x-0 bottom-[7.5rem] z-[70] flex justify-center px-4 lg:bottom-[6.5rem]">
          <Toast
            key={toast.id}
            message={toast.message}
            detail={toast.detail}
            tone={toast.tone}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}
