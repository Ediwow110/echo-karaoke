import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { QueueIcon } from '@phosphor-icons/react/dist/csr/Queue';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward';
import { SpeakerHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerHigh';
import { useHostRoom } from './useHostRoom';
import { useHostPlayer } from '../features/playback/useHostPlayer';
import { UpNextList } from '../features/queue/QueueRows';
import InviteCard from '../features/rooms/InviteCard';
import { isFavorite, subscribeLibrary, toggleFavorite } from '../features/library/libraryStore';
import { formatTime, onlineGuestCount } from '../lib/format';
import { Button, Chip, IconButton, Logo, SongArtwork, TransportButton } from '../ui';

export default function HostStagePage() {
  const {
    roomId,
    roomName,
    code,
    hostName,
    joinUrl,
    roster,
    playback,
    nowPlaying,
    upNext,
    connection,
    togglePlay,
    next,
  } = useHostRoom();
  const player = useHostPlayer();
  const navigate = useNavigate();

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player.seekBy, player.toggleFullscreen, togglePlay]);

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

  return (
    <div className="min-h-dvh bg-graphite text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-graphite/95 backdrop-blur animate-console-in">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size="md" wordmarkClassName="hidden sm:inline" />
            <span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
            <Link
              to={'/room/' + roomId + '/host'}
              aria-label="Back to discovery"
              className="inline-flex size-8 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink sm:hidden"
            >
              <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
            </Link>
            <Link to={'/room/' + roomId + '/host'} className="hidden items-center gap-1.5 text-[0.6875rem] text-ink-2 hover:text-ink sm:flex">
              <ArrowLeftIcon size={14} weight="bold" aria-hidden="true" />
              Back to discovery
            </Link>
          </div>
          <div className="hidden sm:block">
            <Chip tone="gold">Your private stage</Chip>
          </div>
          <div className="flex items-center gap-2">
            {connection === 'offline' ? <Chip tone="gold">Reconnecting</Chip> : null}
            <Link
              to={'/room/' + roomId + '/host/party'}
              className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-media border border-line bg-surface px-3 text-[0.75rem] font-semibold text-ink hover:border-line-strong"
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
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1600px] gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <main className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 animate-console-in" style={{ animationDelay: '40ms' }}>
            <div className="flex min-w-0 items-center gap-3">
              <SongArtwork src={nowPlaying?.thumbnailUrl} className="h-11 w-11" iconSize={16} />
              <div className="min-w-0">
                <h1 className="truncate font-display text-[1.35rem] font-bold tracking-[-0.02em] text-ink">
                  {nowPlaying?.title ?? 'The stage is yours.'}
                </h1>
                <p className="truncate text-[0.6875rem] text-ink-2">
                  {nowPlaying === null ? 'Add a song to start the set' : (nowPlaying.channelTitle ?? 'YouTube') + ' · Added by ' + nowPlaying.addedBy}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Chip tone="default">{upNext.length} up next</Chip>
              <Link to={queueHref} className="inline-flex min-h-6 items-center gap-1.5 px-1 text-[0.6875rem] font-semibold text-ink-2 hover:text-ink">
                <QueueIcon size={14} aria-hidden="true" />
                Queue
              </Link>
            </div>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-panel border border-line bg-graphite-deep shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
            {nowPlaying !== null && playback?.currentVideoId != null ? (
              <div ref={attachSlot} className="absolute inset-0" data-stage-slot />
            ) : (
              <>
                <img src="/images/stage-spotlight.jpg" alt="" className="stage-pan absolute inset-0 h-full w-full object-cover opacity-70" loading="lazy" />
                <div className="absolute inset-0 stage-sheen" aria-hidden="true" />
                <div className="stage-smoke absolute inset-0" aria-hidden="true" />
                <div className="relative grid h-full place-items-center px-6 text-center">
                  <div className="max-w-[30rem]">
                    <p className="eyebrow text-gold">Your private stage</p>
                    <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.2rem)] font-bold leading-[0.98] tracking-[-0.04em] text-ink">
                      Let's hear your encore.
                    </h2>
                    <p className="mx-auto mt-3 max-w-[38ch] text-[0.8125rem] leading-[1.65] text-ink-2">
                      No video is playing. Search for a song and start it from the host screen.
                    </p>
                    <Button
                      variant="primary"
                      size="md"
                      className="mt-5"
                      icon={<PlayIcon size={15} weight="fill" />}
                      onClick={() => navigate('/room/' + roomId + '/host')}
                    >
                      Find the first song
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="mt-4 rounded-panel border border-line bg-surface px-4 py-3.5 animate-console-in" style={{ animationDelay: '120ms' }}>
            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-[0.6875rem] tabular text-ink-2">{formatTime(current)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(duration))}
                value={Math.min(Math.floor(current), Math.max(1, Math.floor(duration)))}
                onChange={(event) => player.seekTo(Number(event.target.value))}
                aria-label="Playback position"
                disabled={nowPlaying === null || duration <= 0}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-signal disabled:cursor-default"
                style={{ background: 'linear-gradient(to right, var(--color-signal) ' + progress + '%, var(--color-line) ' + progress + '%)' }}
              />
              <span className="w-10 shrink-0 text-right text-[0.6875rem] tabular text-ink-2">{duration > 0 ? formatTime(duration) : '—:—'}</span>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={favorite}
                  disabled={nowPlaying === null}
                  aria-pressed={saved}
                  className={['inline-flex min-h-6 items-center gap-1.5 px-1 text-[0.6875rem] transition-colors', saved ? 'text-signal' : 'text-ink-2 hover:text-ink'].join(' ')}
                >
                  <HeartIcon size={15} weight={saved ? 'fill' : 'regular'} aria-hidden="true" />
                  {saved ? 'Saved' : 'Save'}
                </button>
                <span className="hidden items-center gap-1.5 text-[0.6875rem] text-ink-2 sm:flex">
                  <span
                    aria-hidden="true"
                    className={[
                      'size-1.5 rounded-full',
                      player.playerError !== null ? 'bg-danger' : player.needsTap ? 'bg-gold' : 'bg-live',
                    ].join(' ')}
                  />
                  {player.playerError !== null ? 'Playback error' : player.needsTap ? 'Autoplay blocked' : 'Autoplay on'}
                </span>
              </div>

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

              <div className="flex items-center gap-2">
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

          <p className="mt-3 hidden items-center justify-center gap-5 text-[0.5625rem] tracking-[0.02em] text-ink-3 sm:flex">
            <span>SPACE Pause / play</span>
            <span>← → Skip 10 seconds</span>
            <span>F Full screen</span>
            <span>HOST CONTROLS</span>
          </p>
        </main>

        <aside className="flex min-w-0 flex-col gap-4 animate-console-in" style={{ animationDelay: '160ms' }} aria-label="Room queue">
          <section className="rounded-panel border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-[1.35rem] font-bold tracking-[-0.02em] text-ink">Room queue</h2>
              <Link to={queueHref} aria-label="Manage room queue" className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink">
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
                emptyDescription="Search from this screen or any phone to keep the set going."
              />
            </div>
            <Link to={'/room/' + roomId + '/host'} className="mt-3 inline-flex min-h-6 items-center px-1 text-[0.6875rem] font-semibold text-signal hover:underline">
              Add more songs
            </Link>
          </section>

          <InviteCard
            roomName={roomName}
            code={code}
            hostName={hostName}
            joinUrl={joinUrl}
            guests={onlineGuestCount(roster)}
            shareReady={connection === 'live'}
            variant="compact"
          />
        </aside>
      </div>
    </div>
  );
}
