import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRightIcon,
  ListBulletsIcon,
  MicrophoneStageIcon,
  PlusIcon,
  QueueIcon,
} from '@phosphor-icons/react';
import { useHostRoom } from './useHostRoom';
import LiveNowPlayingCard from '../features/queue/LiveNowPlayingCard';
import { UpNextList } from '../features/queue/QueueRows';
import SongSearchPanel from '../features/queue/SongSearchPanel';
import PopularSongs from '../features/queue/PopularSongs';
import InviteCard from '../features/rooms/InviteCard';
import { queueSummary } from '../lib/format';
import { Button, Chip } from '../ui';

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
  const players = roster.filter((member) => member.role === 'guest').length;

  const focusSearch = useCallback(() => {
    searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      <section className="relative overflow-hidden rounded-panel border border-line bg-graphite-deep" aria-labelledby="discover-title">
        <img
          src="/images/discover-spotlight.jpg"
          alt="A singer performing under a warm stage light"
          width={1600}
          height={510}
          fetchPriority="high"
          className="stage-drift absolute inset-0 h-full w-full object-cover object-[62%_35%]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,13,24,0.96)_0%,rgba(16,13,24,0.82)_42%,rgba(16,13,24,0.18)_100%)]" aria-hidden="true" />
        <div className="relative flex min-h-[19rem] flex-col justify-between gap-8 p-6 sm:min-h-[21rem] sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Chip tone="gold">{roomName} room</Chip>
            <Chip tone="dark">Hosted by {hostName}</Chip>
          </div>
          <div className="max-w-[34rem]">
            <h2 id="discover-title" className="font-display text-[clamp(2.3rem,3.6vw,3rem)] font-bold leading-[1] tracking-[-0.04em] text-ink">
              Sing live from YouTube.
            </h2>
            <p className="mt-4 max-w-[42ch] text-[0.8125rem] leading-[1.65] text-ink-2">
              Search YouTube karaoke tracks, add them to the room queue, and keep the session moving automatically.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Button
                variant="primary"
                size="md"
                icon={<MicrophoneStageIcon size={16} weight="duotone" />}
                busy={starting}
                onClick={() => void startSession()}
              >
                {nowPlaying !== null ? 'Take the stage' : upNext.length > 0 ? 'Start this session' : 'Find the first song'}
              </Button>
              <span className="text-[0.6875rem] text-ink-2">
                {queue.length > 0 ? queueSummary(queue) : 'No songs yet · start with a search'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section ref={searchRef} className="rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="search-title">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="eyebrow text-gold">Add the next chorus</p>
                <h2 id="search-title" className="mt-1 font-display text-[1.65rem] font-bold tracking-[-0.025em] text-ink">
                  YouTube karaoke search
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
                    queuedVideoIds={queue.map((song) => song.videoId)}
                    onAdded={() => { void refresh(); }}
                  />
                )}
              />
            </div>
          </section>

          <InviteCard
            roomName={roomName}
            code={code}
            hostName={hostName}
            joinUrl={joinUrl}
            guests={roster.length}
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Room queue">
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
                <Link to={queueHref} className="text-[0.6875rem] font-semibold text-signal hover:underline">
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
                className="mt-3 inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-ink-2 hover:text-ink"
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
