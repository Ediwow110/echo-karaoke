import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { LaptopIcon } from '@phosphor-icons/react/dist/csr/Laptop';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { QueueIcon } from '@phosphor-icons/react/dist/csr/Queue';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward';
import { SpeakerHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerHigh';
import { TelevisionIcon } from '@phosphor-icons/react/dist/csr/Television';
import { useHostRoom } from './useHostRoom';
import { useHostPlayer } from '../features/playback/useHostPlayer';
import { UpNextList } from '../features/queue/QueueRows';
import SongSearchPanel from '../features/queue/SongSearchPanel';
import PopularSongs from '../features/queue/PopularSongs';
import InviteCard from '../features/rooms/InviteCard';
import { isFavorite, subscribeLibrary, toggleFavorite } from '../features/library/libraryStore';
import { formatTime, onlineGuestCount } from '../lib/format';
import { Button, Chip, IconButton, Logo, SongArtwork, TransportButton } from '../ui';

// The view switch is a query param on this route, not a link to another screen.
// The player itself survives a route change either way, because HostRoomPage keys
// it to the room. What a navigation would cost is this screen's measured slot:
// the video would hop to the floating frame and re-lay-out under the host's hands,
// so a view change stays a view change.
const LAYOUT_PARAM = 'layout';

export default function HostStagePage() {
  const {
    roomId,
    roomName,
    code,
    hostName,
    joinUrl,
    roster,
    queue,
    playback,
    nowPlaying,
    upNext,
    connection,
    refresh,
    togglePlay,
    next,
  } = useHostRoom();
  const player = useHostPlayer();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const laptop = params.get(LAYOUT_PARAM) === 'laptop';

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);
  const [saved, setSaved] = useState(() => nowPlaying !== null && isFavorite(nowPlaying.videoId));
  const [busy, setBusy] = useState<'play' | 'next' | null>(null);
  const videoId = nowPlaying?.videoId ?? null;

  useEffect(() => {
    const sync = (): void => setSaved(videoId !== null && isFavorite(videoId));
    sync();
    return subscribeLibrary(sync);
  }, [videoId]);

  const attachSlot = useCallback((node: HTMLDivElement | null) => {
    player.registerStageSlot(node);
  }, [player.registerStageSlot]);

  const switchLayout = useCallback((): void => {
    setParams({ [LAYOUT_PARAM]: laptop ? 'tv' : 'laptop' }, { replace: true });
  }, [laptop, setParams]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, select, button, a, [role="slider"]') !== null)) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        void togglePlay();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        player.seekBy(-10);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        player.seekBy(10);
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        player.toggleFullscreen();
        return;
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        switchLayout();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player.seekBy, player.toggleFullscreen, switchLayout, togglePlay]);

  async function playPause(): Promise<void> {
    setBusy('play');
    try {
      await togglePlay();
    } finally {
      setBusy(null);
    }
  }

  async function skip(): Promise<void> {
    setBusy('next');
    try {
      await next();
    } finally {
      setBusy(null);
    }
  }

  function favorite(): void {
    if (nowPlaying === null) return;
    setSaved(toggleFavorite(nowPlaying));
  }

  const playing = playback?.isPlaying === true;
  const duration = Number.isFinite(player.duration) && player.duration > 0
    ? player.duration
    : nowPlaying?.durationSeconds ?? 0;
  const rawCurrent = Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0;
  const current = duration > 0 ? Math.min(rawCurrent, duration) : rawCurrent;
  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const queueHref = '/room/' + roomId + '/host/queue';
  // One computation feeds both the dot and its words. They used to be two
  // separate ternaries whose catch-all promised live autoplay on a room that
  // was merely not broken -- paused, empty and stalled all read "Autoplay on".
  const status = player.playerError !== null
    ? { dot: 'bg-danger', label: 'Playback error' }
    : player.advanceStalled
      ? { dot: 'bg-gold', label: 'Playback stalled' }
      : player.needsTap
        ? { dot: 'bg-gold', label: 'Autoplay blocked' }
        : playing
          ? { dot: 'bg-live', label: 'Autoplay on' }
          : { dot: 'bg-line', label: 'Ready' };

  return (
    <div className="flex min-h-dvh flex-col bg-graphite text-ink lg:h-dvh lg:overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3 sm:px-4">
        <Logo size="sm" wordmarkClassName="hidden sm:inline" />
        <span className="hidden sm:block">
          <Chip tone="gold">Your private stage</Chip>
        </span>
        <div className="ml-auto flex items-center gap-2">
          {connection === 'offline' ? <Chip tone="gold">Reconnecting</Chip> : null}
          <span className="inline-flex min-h-9 items-center gap-1.5 rounded-media border border-line bg-surface px-2.5 text-[0.6875rem] text-ink-2">
            <span
              aria-hidden="true"
              className={['size-1.5 rounded-full', connection === 'offline' ? 'bg-gold' : 'bg-live'].join(' ')}
            />
            {onlineGuestCount(roster)} in room
          </span>
          <button
            type="button"
            onClick={switchLayout}
            aria-pressed={laptop}
            className="inline-flex min-h-11 items-center gap-2 rounded-media border border-signal/40 bg-signal-soft px-3 text-[0.75rem] font-semibold text-signal transition-[background-color,border-color] duration-150 hover:border-signal"
          >
            {laptop ? <TelevisionIcon size={16} aria-hidden="true" /> : <LaptopIcon size={16} aria-hidden="true" />}
            Switch to {laptop ? 'TV' : 'laptop'}
          </button>
          <Link
            to={'/room/' + roomId + '/host/party'}
            className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-media border border-line bg-surface px-3 text-[0.75rem] font-semibold text-ink hover:border-line-strong"
          >
            <ArrowsOutIcon size={14} aria-hidden="true" />
            Party view
          </Link>
          <IconButton
            icon={<SignOutIcon size={17} />}
            label="Leave host screen"
            tone="ghost"
            size="sm"
            placement="bottom"
            onClick={() => navigate('/')}
          />
        </div>
      </header>

      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 p-3 lg:flex-row lg:gap-4 lg:p-4">
        <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          <div className="mb-2 flex min-w-0 items-center gap-3">
            <SongArtwork src={nowPlaying?.thumbnailUrl} className="h-10 w-10 shrink-0" iconSize={15} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-[clamp(1.35rem,2.4vw,2.1rem)] font-bold leading-tight tracking-[-0.025em] text-ink">
                {nowPlaying?.title ?? 'The stage is yours.'}
              </h1>
              <p className="truncate text-[0.6875rem] text-ink-2">
                {nowPlaying === null
                  ? 'Add a song to start the set'
                  : (nowPlaying.channelTitle ?? 'YouTube') + ' · Added by ' + nowPlaying.addedBy}
              </p>
            </div>
            <span className="hidden shrink-0 items-center gap-1.5 text-[0.6875rem] text-ink-2 sm:flex">
              <span aria-hidden="true" className={['size-1.5 rounded-full', status.dot].join(' ')} />
              {status.label}
            </span>
            <Chip tone="default" className="shrink-0">{upNext.length} up next</Chip>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-panel border border-line bg-graphite-deep lg:aspect-auto lg:min-h-0 lg:flex-1" data-stage-frame>
            {nowPlaying !== null && playback?.currentVideoId != null ? (
              <div ref={attachSlot} className="absolute inset-0" data-stage-slot />
            ) : (
              <>
                <img src="/images/stage-spotlight.jpg" alt="" className="stage-pan absolute inset-0 h-full w-full object-cover opacity-70" loading="lazy" />
                <div className="absolute inset-0 stage-sheen" aria-hidden="true" />
                <div className="stage-smoke absolute inset-0" aria-hidden="true" />
                <div className="relative grid h-full place-items-center px-6 text-center">
                  <div className="max-w-[34rem]">
                    <p className="eyebrow text-gold">{roomName}</p>
                    <h2 className="mt-2 font-display text-[clamp(2rem,4.6vw,3.6rem)] font-bold leading-[0.98] tracking-[-0.04em] text-ink">
                      Let's hear your encore.
                    </h2>
                    <p className="mx-auto mt-3 max-w-[40ch] text-[0.8125rem] leading-[1.65] text-ink-2">
                      {laptop
                        ? 'Search above, or hand the code to anyone with a phone.'
                        : 'Scan the code to search from a phone and queue songs straight to this screen.'}
                    </p>
                    {laptop ? null : (
                      <Button
                        variant="primary"
                        size="md"
                        className="mt-5"
                        icon={<PlayIcon size={15} weight="fill" />}
                        onClick={() => navigate('/room/' + roomId + '/host')}
                      >
                        Find the first song
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="pointer-events-none absolute bottom-3 left-3 z-30 max-w-[min(21rem,88vw)]" data-join-overlay>
              <InviteCard
                roomName={roomName}
                code={code}
                hostName={hostName}
                joinUrl={joinUrl}
                guests={onlineGuestCount(roster)}
                shareReady={connection === 'live'}
                variant="party"
                className="pointer-events-auto"
              />
            </div>
          </div>

          <div className="mt-3 shrink-0 rounded-panel border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-[0.6875rem] tabular text-ink-2">{formatTime(current)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(duration))}
                value={Math.min(Math.floor(current), Math.max(1, Math.floor(duration)))}
                onChange={(event) => player.previewSeek(Number(event.target.value))}
                onPointerUp={player.commitSeek}
                onKeyUp={player.commitSeek}
                aria-label="Playback position"
                disabled={nowPlaying === null || duration <= 0}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-signal disabled:cursor-default"
                style={{ background: 'linear-gradient(to right, var(--color-signal) ' + progress + '%, var(--color-line) ' + progress + '%)' }}
              />
              <span className="w-10 shrink-0 text-right text-[0.6875rem] tabular text-ink-2">{duration > 0 ? formatTime(duration) : '—:—'}</span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <TransportButton
                  icon={<ArrowCounterClockwiseIcon size={18} />}
                  label="Back 10 seconds"
                  onClick={() => player.seekBy(-10)}
                  disabled={nowPlaying === null}
                  size="md"
                />
                <TransportButton
                  icon={busy === 'play' ? <ArrowClockwiseIcon size={18} className="animate-spin" /> : playing ? <PauseIcon size={20} weight="fill" /> : <PlayIcon size={20} weight="fill" />}
                  label={playing ? 'Pause' : 'Play'}
                  onClick={() => void playPause()}
                  disabled={nowPlaying === null || busy !== null}
                  size="lg"
                  tone="primary"
                />
                <TransportButton
                  icon={<ArrowClockwiseIcon size={18} />}
                  label="Forward 10 seconds"
                  onClick={() => player.seekBy(10)}
                  disabled={nowPlaying === null}
                  size="md"
                />
                <TransportButton
                  icon={busy === 'next' ? <ArrowClockwiseIcon size={18} className="animate-spin" /> : <SkipForwardIcon size={18} weight="fill" />}
                  label="Skip song"
                  onClick={() => void skip()}
                  disabled={nowPlaying === null || busy !== null}
                  size="md"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={favorite}
                  disabled={nowPlaying === null}
                  aria-pressed={saved}
                  className={['inline-flex min-h-9 items-center gap-1.5 px-1 text-[0.6875rem] transition-colors', saved ? 'text-signal' : 'text-ink-2 hover:text-ink'].join(' ')}
                >
                  <HeartIcon size={15} weight={saved ? 'fill' : 'regular'} aria-hidden="true" />
                  {saved ? 'Saved' : 'Save'}
                </button>
                <Link to={queueHref} className="inline-flex min-h-9 items-center gap-1.5 px-1 text-[0.6875rem] font-semibold text-ink-2 hover:text-ink">
                  <QueueIcon size={14} aria-hidden="true" />
                  Queue
                </Link>
                <span className="flex items-center gap-2">
                  <SpeakerHighIcon size={15} className="text-ink-2" aria-hidden="true" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Number.isFinite(player.volume) ? player.volume : 100}
                    onChange={(event) => player.setVolume(Number(event.target.value))}
                    aria-label="Volume"
                    className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-line accent-signal"
                  />
                </span>
                <IconButton
                  icon={<ArrowsOutIcon size={16} />}
                  label={player.fullscreen ? 'Exit fullscreen' : 'Fullscreen player'}
                  tone="ghost"
                  size="sm"
                  onClick={player.toggleFullscreen}
                />
              </div>
            </div>
          </div>
        </main>

        {laptop ? (
          <aside className="flex w-full min-w-0 shrink-0 flex-col gap-3 lg:w-[25rem] lg:overflow-y-auto" aria-label="Stage controls">
            <section className="rounded-panel border border-line bg-surface p-4">
              <p className="eyebrow text-gold">Add the next chorus</p>
              <h2 className="mt-1 font-display text-[1.15rem] font-bold tracking-[-0.02em] text-ink">Search and queue</h2>
              <div className="mt-3">
                <SongSearchPanel
                  roomId={roomId}
                  queue={queue}
                  variant="host"
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

            <section className="rounded-panel border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-[1.15rem] font-bold tracking-[-0.02em] text-ink">Room queue</h2>
                <Link to={queueHref} aria-label="Manage room queue" className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink">
                  <QueueIcon size={17} aria-hidden="true" />
                </Link>
              </div>
              <p className="mt-1.5 text-[0.6875rem] leading-[1.55] text-ink-2">
                Songs play in order. The next video starts automatically when the current one ends.
              </p>
              <div className="mt-3">
                <UpNextList
                  queue={upNext}
                  variant="stage"
                  emptyTitle="Queue is empty."
                  emptyDescription="Search here or on any phone to keep the set going."
                />
              </div>
            </section>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
