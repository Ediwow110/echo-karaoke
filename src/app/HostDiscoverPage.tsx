import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets';
import { MicrophoneStageIcon } from '@phosphor-icons/react/dist/csr/MicrophoneStage';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { QueueIcon } from '@phosphor-icons/react/dist/csr/Queue';
import { useHostRoom } from './useHostRoom';
import LiveNowPlayingCard from '../features/queue/LiveNowPlayingCard';
import { UpNextList } from '../features/queue/QueueRows';
import SongSearchPanel from '../features/queue/SongSearchPanel';
import PopularSongs from '../features/queue/PopularSongs';
import InviteCard from '../features/rooms/InviteCard';
import { onlineGuestCount, queueSummary } from '../lib/format';
import { Button } from '../ui';
import { scrollToElement } from '../features/queue/queueAnchor';

export default function HostDiscoverPage() {
  const {
    roomId,
    roomName,
    hostName,
    joinUrl,
    code,
    roster,
    queue,
    nowPlaying,
    upNext,
    playback,
    connection,
    refresh,
    togglePlay,
  } = useHostRoom();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const searchRef = useRef<HTMLDivElement | null>(null);
  const [starting, setStarting] = useState(false);
  const stageHref = '/room/' + roomId + '/host/stage';
  const queueHref = '/room/' + roomId + '/host/queue';
  const players = onlineGuestCount(roster);

  const focusSearch = useCallback(() => {
    scrollToElement(searchRef.current, 'center');
    window.setTimeout(() => {
      document.getElementById('song-search')?.focus();
    }, 80);
  }, []);

  async function startSession(): Promise<void> {
    if (nowPlaying !== null) {
      navigate(stageHref);
      return;
    }
    if (upNext.length > 0) {
      setStarting(true);
      try {
        await togglePlay();
        navigate(stageHref);
      } finally {
        setStarting(false);
      }
      return;
    }
    focusSearch();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-console-in" data-host-hero="room-invite">
        <InviteCard
          roomName={roomName}
          code={code}
          hostName={hostName}
          joinUrl={joinUrl}
          guests={players}
          shareReady={connection === 'live'}
          className="p-6 sm:p-8"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section ref={searchRef} className="rounded-panel border border-line bg-surface p-5 sm:p-6 animate-console-in" style={{ animationDelay: '60ms' }} aria-labelledby="search-title">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="eyebrow text-gold">Add the next chorus</p>
                <h2 id="search-title" className="mt-1 font-display text-[1.65rem] font-bold tracking-[-0.025em] text-ink">
                  kara-echo song search
                </h2>
              </div>
              <p className="text-[0.6875rem] text-ink-2">Powered by YouTube</p>
            </div>
            <div className="mt-5">
              <SongSearchPanel
                key={initialQuery}
                roomId={roomId}
                queue={queue}
                variant="host"
                initialQuery={initialQuery}
                onAdded={() => { void refresh(); }}
                onOpenQueue={() => navigate(queueHref)}
                popularSlot={(
                  <PopularSongs
                    roomId={roomId}
                    layout="vertical"
                    queuedVideoIds={queue.map((song) => song.videoId)}
                    moreHref={'/room/' + roomId + '/host/songbook'}
                    onAdded={() => { void refresh(); }}
                  />
                )}
              />
            </div>
          </section>

        </div>

        <aside className="flex min-w-0 flex-col gap-4 animate-console-in" style={{ animationDelay: '120ms' }} aria-label="Room queue">
          <section className="rounded-panel border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-[1.3rem] font-bold tracking-[-0.02em] text-ink">YouTube queue</h2>
              <Link to={queueHref} aria-label="Open the full room queue" className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink">
                <ListBulletsIcon size={17} aria-hidden="true" />
              </Link>
            </div>
            <div className="mt-3">
              <LiveNowPlayingCard
                song={nowPlaying}
                playback={playback}
                variant="side"
                emptyTitle="The stage is quiet."
                emptyDescription="Add the first song and the room will follow."
                emptyAction={<Button variant="secondary" size="sm" onClick={focusSearch}>Find a song</Button>}
              />
            </div>
            <Button
              variant="primary"
              size="md"
              full
              className="mt-3"
              icon={<MicrophoneStageIcon size={16} weight="duotone" />}
              onClick={() => void startSession()}
              busy={starting}
            >
              {nowPlaying !== null ? 'Take the stage' : upNext.length > 0 ? 'Start the session' : 'Find the first song'}
            </Button>

            <div className="mt-5 border-t border-line pt-4">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className="eyebrow text-ink-2">Up next</p>
                  <p className="mt-1 text-[0.6875rem] text-ink-2">
                    {upNext.length === 0 ? 'Nothing waiting.' : queueSummary(upNext)}
                  </p>
                </div>
                <Link to={queueHref} className="inline-flex min-h-6 items-center px-1 text-[0.6875rem] font-semibold text-signal hover:underline">
                  Full queue
                </Link>
              </div>
              <div className="mt-3">
                <UpNextList
                  queue={upNext}
                  variant="side"
                  emptyTitle="A fresh running order."
                  emptyDescription="Every guest can add a song from their phone."
                  emptyAction={<Button variant="quiet" size="sm" icon={<PlusIcon size={14} weight="bold" />} onClick={focusSearch}>Add a song</Button>}
                />
              </div>
              <Link
                to={queueHref}
                className="mt-3 inline-flex min-h-6 items-center gap-1 px-1 text-[0.6875rem] font-semibold text-ink-2 hover:text-ink"
              >
                <QueueIcon size={14} aria-hidden="true" />
                Manage the running order
                <ArrowRightIcon size={11} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          </section>

          <section className="rounded-panel border border-line bg-surface p-4">
            <p className="eyebrow text-ink-2">Host screen</p>
            <p className="mt-2 text-[0.75rem] leading-[1.6] text-ink-2">
              Phones are remotes for search and queue. Video and audio stay on this display.
            </p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[0.6875rem] text-ink">{players} guest {players === 1 ? 'remote' : 'remotes'}</span>
              <span className={['flex items-center gap-1.5 text-[0.6875rem]', connection === 'live' ? 'text-live' : 'text-gold'].join(' ')}>
                <span
                  aria-hidden="true"
                  className={['size-1.5 rounded-full', connection === 'live' ? 'animate-presence-pulse bg-live' : 'bg-gold'].join(' ')}
                />
                {connection === 'live' ? 'Live' : connection === 'offline' ? 'Reconnecting' : 'Connecting'}
              </span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
