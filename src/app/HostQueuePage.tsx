import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecksIcon } from '@phosphor-icons/react/dist/csr/ListChecks';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward';
import { useHostRoom } from './useHostRoom';
import LiveNowPlayingCard from '../features/queue/LiveNowPlayingCard';
import { UpNextList } from '../features/queue/QueueRows';
import SongSearchPanel from '../features/queue/SongSearchPanel';
import InviteCard from '../features/rooms/InviteCard';
import { QUEUE_ELEMENT_ID, scrollToElement } from '../features/queue/queueAnchor';
import { queueSummary } from '../lib/format';
import { Button, Chip } from '../ui';

export default function HostQueuePage() {
  const {
    roomId,
    roomName,
    hostName,
    code,
    joinUrl,
    roster,
    queue,
    nowPlaying,
    upNext,
    playback,
    refresh,
    next,
    removeSong,
    reorderSong,
  } = useHostRoom();
  const [busySongId, setBusySongId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);

  const focusSearch = useCallback(() => {
    scrollToElement(searchRef.current, 'center');
    window.setTimeout(() => document.getElementById('song-search')?.focus(), 80);
  }, []);

  async function handleRemove(songId: string): Promise<void> {
    setBusySongId(songId);
    try {
      await removeSong(songId);
    } finally {
      setBusySongId(null);
    }
  }

  async function handleReorder(songId: string, direction: 'up' | 'down'): Promise<void> {
    setBusySongId(songId);
    try {
      await reorderSong(songId, direction);
    } finally {
      setBusySongId(null);
    }
  }

  async function skip(): Promise<void> {
    setSkipping(true);
    try {
      await next();
    } finally {
      setSkipping(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-gold">Running order</p>
          <h2 className="mt-1 font-display text-[clamp(1.9rem,2.8vw,2.15rem)] font-bold leading-[1.08] tracking-[-0.03em] text-ink">
            Keep the night moving.
          </h2>
          <p className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
            Your room, your running order. Everyone gets a moment.
          </p>
        </div>
        <Chip tone="signal">Host moderation</Chip>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="rounded-panel border border-line bg-surface p-5" aria-labelledby="now-playing-title">
            <div className="flex items-center justify-between gap-3">
              <h3 id="now-playing-title" className="eyebrow text-gold">Now playing</h3>
              <span className="text-[0.625rem] text-ink-2">Host screen · Auto-advance on</span>
            </div>
            <div className="mt-3">
              <LiveNowPlayingCard
                song={nowPlaying}
                playback={playback}
                variant="host"
                showHeader={false}
                emptyTitle="The stage is quiet."
                emptyDescription="Add a song and start playback on this host screen."
                emptyAction={<Button variant="secondary" size="sm" icon={<PlusIcon size={14} weight="bold" />} onClick={focusSearch}>Add a song</Button>}
              />
            </div>
          </section>

          <section aria-labelledby="up-next-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 id="up-next-title" className="font-display text-[1.65rem] font-bold tracking-[-0.025em] text-ink">Up next</h3>
                <p className="mt-1 text-[0.75rem] text-ink-2">
                  {upNext.length === 0 ? 'The queue is empty.' : queueSummary(upNext) + ' · Host moderation'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<SkipForwardIcon size={15} weight="fill" />}
                disabled={nowPlaying === null || skipping}
                busy={skipping}
                onClick={() => void skip()}
              >
                Skip current song
              </Button>
            </div>
            <div className="mt-3 rounded-panel border border-line bg-surface p-5">
              <UpNextList
                queue={upNext}
                variant="table"
                listId={QUEUE_ELEMENT_ID}
                onRemove={(songId) => { void handleRemove(songId); }}
                onReorder={(songId, direction) => { void handleReorder(songId, direction); }}
                busySongId={busySongId}
                emptyTitle="A fresh running order."
                emptyDescription="Add the first song to get things started. Everyone in the room can contribute."
                emptyAction={<Button variant="primary" size="sm" icon={<PlusIcon size={14} weight="bold" />} onClick={focusSearch}>Add the first song</Button>}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-[0.6875rem] leading-[1.5] text-ink-2">
                  Use the arrows to reorder. The × removes a song. Skip and moderation stay host-only.
                </p>
                <Link
                  to={'/room/' + roomId + '/host'}
                  className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-signal hover:underline"
                >
                  <PlusIcon size={13} weight="bold" aria-hidden="true" />
                  Add more songs
                </Link>
              </div>
            </div>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <section ref={searchRef} className="rounded-panel border border-line bg-surface p-5" aria-labelledby="queue-search-title">
            <p className="eyebrow text-gold">Search</p>
            <h3 id="queue-search-title" className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.025em] text-ink">Find the next chorus.</h3>
            <div className="mt-4">
              <SongSearchPanel
                roomId={roomId}
                queue={queue}
                variant="host"
                onAdded={() => { void refresh(); }}
                onOpenQueue={() => scrollToElement(document.getElementById(QUEUE_ELEMENT_ID), 'center')}
              />
            </div>
          </section>

          <section className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <ListChecksIcon size={18} className="text-signal" aria-hidden="true" />
              <h3 className="font-display text-[1.2rem] font-bold tracking-[-0.02em] text-ink">Queue rules</h3>
            </div>
            <p className="mt-3 text-[0.75rem] leading-[1.65] text-ink-2">
              Songs play in the order they appear. Each guest can add five songs a minute.
            </p>
            <p className="mt-2 text-[0.6875rem] leading-[1.6] text-ink-2">
              Skip, remove and reorder are always host-only. Automatic advance starts the next song when a video ends.
            </p>
          </section>

          <InviteCard
            roomName={roomName}
            code={code}
            hostName={hostName}
            joinUrl={joinUrl}
            guests={roster.length}
            variant="compact"
          />
        </aside>
      </div>
    </div>
  );
}
