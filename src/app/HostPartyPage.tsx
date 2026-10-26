import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowsInIcon } from '@phosphor-icons/react/dist/csr/ArrowsIn';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward';
import { SpeakerHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerHigh';
import { useHostRoom } from './useHostRoom';
import { useHostPlayer } from '../features/playback/useHostPlayer';
import InviteCard from '../features/rooms/InviteCard';
import { formatTime, onlineGuestCount, queueSummary } from '../lib/format';
import { Button, Chip, Logo, SongArtwork, TransportButton } from '../ui';

export default function HostPartyPage() {
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
  const [busy, setBusy] = useState<'play' | 'next' | null>(null);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  const attachSlot = useCallback((node: HTMLDivElement | null) => {
    player.registerStageSlot(node);
  }, [player.registerStageSlot]);

  const backToStage = useCallback((): void => {
    const stageHref = '/room/' + roomId + '/host/stage';
    if (document.fullscreenElement !== null && document.fullscreenElement !== undefined) {
      void document.exitFullscreen().finally(() => navigate(stageHref));
      return;
    }
    navigate(stageHref);
  }, [navigate, roomId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, select, button, a, [role="slider"]') !== null)) {
        return;
      }
      if (event.key === 'Escape') {
        backToStage();
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
  }, [backToStage, player.seekBy, player.toggleFullscreen, togglePlay]);

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

  const playing = playback?.isPlaying === true;
  const duration = Number.isFinite(player.duration) && player.duration > 0
    ? player.duration
    : nowPlaying?.durationSeconds ?? 0;
  const rawCurrent = Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0;
  const current = duration > 0 ? Math.min(rawCurrent, duration) : rawCurrent;
  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const nextSong = upNext[0] ?? null;
  const hasVideo = nowPlaying !== null && playback?.currentVideoId != null;

  return (
    <div className="flex min-h-dvh flex-col bg-graphite-deep text-ink">
      <header className="z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 sm:px-6 animate-console-in">
        <Logo size="md" />
        <p className="hidden text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-2 sm:block">
          {roomName} · Party view
        </p>
        <div className="flex items-center gap-2">
          {connection === 'offline' ? <Chip tone="gold">Reconnecting</Chip> : null}
          <Button variant="secondary" size="sm" icon={<ArrowsInIcon size={14} />} onClick={backToStage}>
            Leave party view
          </Button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {hasVideo ? (
          <>
            {/* The video fills this screen, so the song title is the only name
                it has. RouteFocus announces a route by the heading inside
                main, and with none here the party view went unannounced. */}
            <h1 className="sr-only">{nowPlaying?.title ?? 'Nothing playing'}</h1>
            <div ref={attachSlot} className="absolute inset-0" data-party-slot />
          </>
        ) : (
          <div className="absolute inset-0 overflow-hidden">
            <img src="/images/stage-spotlight.jpg" alt="" className="stage-pan h-full w-full object-cover opacity-70" />
            <div className="absolute inset-0 stage-sheen" aria-hidden="true" />
            <div className="stage-smoke absolute inset-0" aria-hidden="true" />
            <div className="relative grid h-full place-items-center px-6 text-center">
              <div className="max-w-[32rem]">
                <p className="eyebrow text-gold">{roomName}</p>
                <h1 className="mt-3 font-display text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[0.96] tracking-[-0.045em]">
                  The stage is yours.
                </h1>
                <p className="mx-auto mt-3 max-w-[38ch] text-[0.875rem] leading-[1.65] text-ink-2">
                  Add a song from the room queue, then start it on the host screen.
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <Button variant="primary" onClick={() => navigate('/room/' + roomId + '/host')}>Find a song</Button>
                  <Button variant="secondary" onClick={() => navigate('/room/' + roomId + '/host')}>Back to discovery</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="absolute bottom-4 right-4 z-30 hidden lg:block animate-console-in" style={{ animationDelay: '160ms' }}>
          <InviteCard
            roomName={roomName}
            code={code}
            hostName={hostName}
            joinUrl={joinUrl}
            guests={onlineGuestCount(roster)}
            shareReady={connection === 'live'}
            variant="party"
          />
        </div>
      </main>

      <section className="z-30 shrink-0 border-t border-white/10 bg-graphite-deep/95 px-4 py-3 backdrop-blur sm:px-6 animate-console-in" style={{ animationDelay: '80ms' }} aria-label="Party transport">
        <div className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-[0.625rem] tabular text-ink-2">{formatTime(current)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(duration))}
            value={Math.min(Math.floor(current), Math.max(1, Math.floor(duration)))}
            onChange={(event) => player.seekTo(Number(event.target.value))}
            aria-label="Playback position"
            disabled={!hasVideo || duration <= 0}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-signal disabled:cursor-default"
            style={{ background: 'linear-gradient(to right, var(--color-signal) ' + progress + '%, rgba(255,255,255,0.14) ' + progress + '%)' }}
          />
          <span className="w-10 shrink-0 text-right text-[0.625rem] tabular text-ink-2">{duration > 0 ? formatTime(duration) : '—:—'}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <SongArtwork src={nowPlaying?.thumbnailUrl} className="h-10 w-10" iconSize={15} />
            <div className="min-w-0">
              <p className="truncate text-[0.75rem] font-semibold text-ink">{nowPlaying?.title ?? 'Nothing playing'}</p>
              <p className="truncate text-[0.625rem] text-ink-2">
                {nowPlaying === null ? 'Add a song to take the stage' : (nowPlaying.channelTitle ?? 'YouTube') + ' · Added by ' + nowPlaying.addedBy}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <TransportButton
              icon={<ArrowCounterClockwiseIcon size={17} />}
              label="Back 10 seconds"
              onClick={() => player.seekBy(-10)}
              disabled={!hasVideo}
              size="md"
            />
            <TransportButton
              icon={busy === 'play' ? <ArrowClockwiseIcon size={17} className="animate-spin" /> : playing ? <PauseIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />}
              label={playing ? 'Pause' : 'Play'}
              onClick={() => void playPause()}
              disabled={nowPlaying === null || busy !== null}
              size="md"
              tone="primary"
            />
            <TransportButton
              icon={<ArrowClockwiseIcon size={17} />}
              label="Forward 10 seconds"
              onClick={() => player.seekBy(10)}
              disabled={!hasVideo}
              size="md"
            />
            <TransportButton
              icon={busy === 'next' ? <ArrowClockwiseIcon size={17} className="animate-spin" /> : <SkipForwardIcon size={17} weight="fill" />}
              label="Skip song"
              onClick={() => void skip()}
              disabled={nowPlaying === null || busy !== null}
              size="md"
            />
          </div>

          <div className="flex items-center gap-3">
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
            <button
              type="button"
              onClick={player.toggleFullscreen}
              aria-label={player.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <ArrowsOutIcon size={15} aria-hidden="true" />
            </button>
            <span className="hidden text-[0.625rem] uppercase tracking-[0.06em] text-ink-3 sm:block">Host {hostName} · Esc to exit</span>
          </div>
        </div>
      </section>

      <section className="z-30 flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-graphite-deep px-4 py-2.5 sm:px-6 animate-console-in" style={{ animationDelay: '120ms' }} aria-label="Up next">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Up next</span>
          {nextSong === null ? (
            <p className="text-[0.6875rem] text-ink-2">Queue empty · {queueSummary(upNext)}</p>
          ) : (
            <>
              <SongArtwork src={nextSong.thumbnailUrl} className="h-7 w-7" iconSize={12} />
              <p className="min-w-0 truncate text-[0.6875rem] text-ink">{nextSong.title}</p>
              <p className="hidden truncate text-[0.625rem] text-ink-2 sm:block">
                {nextSong.channelTitle ?? 'YouTube'}
                {nextSong.durationSeconds === null ? '' : ' · ' + formatTime(nextSong.durationSeconds)}
                {' · Added by ' + nextSong.addedBy}
              </p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[0.625rem] text-ink-2">
          <Link to={'/room/' + roomId + '/host/queue'} className="hover:text-ink">Up next · {upNext.length}</Link>
          {nextSong === null ? null : <span className="hidden sm:block">Starts automatically when this video ends</span>}
        </div>
      </section>
    </div>
  );
}
