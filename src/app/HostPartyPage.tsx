import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { DoorOpenIcon } from '@phosphor-icons/react/dist/csr/DoorOpen';
import { LaptopIcon } from '@phosphor-icons/react/dist/csr/Laptop';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward';
import { SpeakerHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerHigh';
import { TelevisionIcon } from '@phosphor-icons/react/dist/csr/Television';
import { useHostRoom } from './useHostRoom';
import { useRoomApi } from './RoomApiProvider';
import { useHostPlayer } from '../features/playback/useHostPlayer';
import { UpNextList } from '../features/queue/QueueRows';
import SongSearchPanel from '../features/queue/SongSearchPanel';
import PopularSongs from '../features/queue/PopularSongs';
import SongbookList from '../features/catalog/SongbookList';
import { CATALOG_CHANNEL_LABELS } from '../features/catalog/catalogApi';
import InviteCard from '../features/rooms/InviteCard';
import { formatTime, groupRoomCode, onlineGuestCount, queueSummary } from '../lib/format';
import { Button, Chip, ConfirmDialog, Logo, QrCode, SongArtwork, TransportButton } from '../ui';

type PanelTab = 'search' | 'queue' | 'songbook';
type Density = 'grid' | 'list';

// The layout is a query param on this route, not a second screen. Stage and Party
// used to be two near-identical audience screens; one route with two layouts keeps
// the measured player slot alive across the switch, which a navigation would not.
const LAYOUT_PARAM = 'layout';
const LAYOUT_TRANSITION_MS = 320;

export default function HostPartyPage() {
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
    removeSong,
    reorderSong,
    voteSong,
    votingSongId,
    togglePlay,
    next,
    runHost,
    notify,
    endRoom,
  } = useHostRoom();
  const api = useRoomApi();
  const player = useHostPlayer();
  const [params, setParams] = useSearchParams();
  const computer = params.get(LAYOUT_PARAM) === 'computer';
  const [panelMounted, setPanelMounted] = useState(computer);
  const panelRef = useRef<HTMLDivElement>(null);
  const switchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (computer) {
      setPanelMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setPanelMounted(false), LAYOUT_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [computer]);

  const [tab, setTab] = useState<PanelTab>(() => {
    const requested = params.get('panel');
    return requested === 'queue' || requested === 'songbook' ? requested : 'search';
  });
  const [searchQuery] = useState(() => params.get('q') ?? '');

  useEffect(() => {
    if (params.get('panel') === null) return;
    // A deep link names the panel it wants; after it opens, the tab is local
    // state and the URL should not keep insisting on this one.
    const next = new URLSearchParams(params);
    next.delete('panel');
    next.delete('q');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const [density, setDensity] = useState<Density>('grid');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function clearQueue(): Promise<void> {
    setClearing(true);
    const accepted = await runHost('clear_queue');
    setClearing(false);
    setConfirmClear(false);
    if (accepted) {
      notify('The queue is clear.', 'Nothing is waiting and playback has stopped.', 'info');
    }
  }

  async function finishRoom(): Promise<void> {
    setEnding(true);
    try {
      // endRoom reports its own failures and navigates home on success.
      await endRoom();
    } finally {
      setEnding(false);
    }
  }

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);
  const [busy, setBusy] = useState<'play' | 'next' | null>(null);

  const attachSlot = useCallback((node: HTMLDivElement | null) => {
    player.registerStageSlot(node);
  }, [player.registerStageSlot]);

  const setLayout = useCallback((next: 'tv' | 'computer'): void => {
    if (next === 'tv' && panelRef.current?.contains(document.activeElement)) {
      switchRef.current?.focus();
    }
    setParams({ [LAYOUT_PARAM]: next }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      // A focused field owns every shortcut, Escape included. The element check
      // matters: a key event fired on the window has the window as its target,
      // and window.closest does not exist.
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null)) {
        return;
      }
      if (event.key === 'Escape') {
        // Escape is "go back to what the room is watching". The stage is the room
        // now, so there is nowhere further to leave to. It stays live over a
        // focused button, because that is where the last click leaves focus.
        if (computer) setLayout('tv');
        return;
      }
      if (target instanceof HTMLElement && target.closest('button, a, [role="slider"]') !== null) {
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
        setLayout(computer ? 'tv' : 'computer');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [computer, player.seekBy, player.toggleFullscreen, setLayout, togglePlay]);

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
    <div className="flex min-h-dvh flex-col bg-graphite-deep text-ink lg:h-dvh lg:overflow-hidden">
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-3 sm:px-4">
        <Logo size="sm" wordmarkClassName="hidden sm:inline" />
        <p className="hidden min-w-0 truncate text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-2 md:block">
          {roomName} · TV stage
        </p>
        <div className="ml-auto flex items-center gap-2">
          {connection === 'offline' ? <Chip tone="gold">Reconnecting</Chip> : null}
          <span className="hidden min-h-9 items-center gap-1.5 rounded-media border border-white/15 bg-graphite-deep/70 px-2.5 text-[0.6875rem] text-ink-2 sm:inline-flex">
            <span
              aria-hidden="true"
              className={['size-1.5 rounded-full', connection === 'offline' ? 'bg-gold' : 'bg-live'].join(' ')}
            />
            {onlineGuestCount(roster)} in room
          </span>
          <button
            ref={switchRef}
            type="button"
            onClick={() => setLayout(computer ? 'tv' : 'computer')}
            aria-pressed={computer}
            className="inline-flex min-h-11 items-center gap-2 rounded-media border border-signal/45 bg-signal-soft px-3 text-[0.75rem] font-semibold text-signal transition-[background-color,border-color] duration-150 hover:border-signal"
          >
            {computer ? <TelevisionIcon size={16} aria-hidden="true" /> : <LaptopIcon size={16} aria-hidden="true" />}
            Switch to {computer ? 'TV' : 'computer'}
          </button>
          <Button
            variant="danger"
            size="sm"
            className="min-h-11"
            icon={<DoorOpenIcon size={15} />}
            onClick={() => setConfirmEnd(true)}
            disabled={connection === 'offline'}
          >
            End room
          </Button>
        </div>
      </header>

      <div
        className="party-layout min-h-0 w-full flex-1 p-3 lg:p-4"
        data-layout={computer ? 'computer' : 'tv'}
        style={{ '--layout-duration': LAYOUT_TRANSITION_MS + 'ms' } as CSSProperties}
      >
        <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          {hasVideo ? (
            <>
              {/* The video fills this screen, so the song title is the only name it
                  has. RouteFocus announces a route by the heading inside main. */}
              <h1 className="sr-only">{nowPlaying?.title ?? 'Nothing playing'}</h1>
              {/* The player refuses a slot under 200px tall, and the frame's 1px
                  border is inside that box, so the floor is 200 plus the border
                  on each side. A frame sized only by aspect ratio fell to 180px
                  on a 320px phone and parked the video without a word. */}
              <div className="relative aspect-video min-h-[202px] w-full overflow-hidden rounded-panel border border-white/10 lg:aspect-auto lg:min-h-0 lg:flex-1" data-stage-frame>
                <div ref={attachSlot} className="absolute inset-0" data-party-slot />
              </div>
            </>
          ) : (
            <div className="relative min-h-[52vh] flex-1 overflow-hidden rounded-panel border border-white/10" data-stage-frame>
              <h1 className="sr-only">The stage is ready</h1>
              <img src="/images/stage-spotlight.jpg" alt="" className="stage-pan absolute inset-0 h-full w-full object-cover opacity-70" loading="lazy" />
              <div className="absolute inset-0 stage-sheen" aria-hidden="true" />
              <div className="stage-smoke absolute inset-0" aria-hidden="true" />
              <div className="relative grid h-full place-items-center px-6 text-center">
                <div className="max-w-[34rem]">
                  <p className="eyebrow text-gold">{roomName}</p>
                  <p className="mt-2 font-display text-[clamp(2rem,4.6vw,3.6rem)] font-bold leading-[0.98] tracking-[-0.04em]">
                    Stage is ready.
                  </p>
                  {computer ? (
                    <p className="mx-auto mt-3 max-w-[40ch] text-[0.8125rem] leading-[1.65] text-ink-2">
                      Search on this panel, or hand the code to anyone with a phone.
                    </p>
                  ) : (
                    <div className="mt-4 flex flex-col items-center gap-3">
                      {connection === 'live' && joinUrl.length > 0 ? (
                        <>
                          <QrCode value={joinUrl} label={'QR code to join ' + roomName} size={180} />
                          <p className="font-mono text-[clamp(1.4rem,3vw,2rem)] font-semibold tracking-[0.18em] text-signal">
                            {groupRoomCode(code)}
                          </p>
                          <p className="text-[0.6875rem] text-ink-2">Scan to join from a phone.</p>
                        </>
                      ) : (
                        <p role="status" className="text-[0.75rem] text-ink-2">
                          The join QR returns when this room reconnects.
                        </p>
                      )}
                      <Button
                        variant="primary"
                        size="md"
                        icon={<LaptopIcon size={15} />}
                        onClick={() => setLayout('computer')}
                      >
                        Add from this computer
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <section className="z-30 mt-3 shrink-0 rounded-panel border border-white/10 bg-graphite-deep/95 px-3 py-2.5 backdrop-blur" aria-label="Party transport">
            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-[0.625rem] tabular text-ink-2">{formatTime(current)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(duration))}
                value={Math.min(Math.floor(current), Math.max(1, Math.floor(duration)))}
                onChange={(event) => player.previewSeek(Number(event.target.value))}
                onPointerUp={player.commitSeek}
                onKeyUp={player.commitSeek}
                aria-label="Playback position"
                disabled={!hasVideo || duration <= 0}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-signal disabled:cursor-default"
                style={{ background: 'linear-gradient(to right, var(--color-signal) ' + progress + '%, rgba(255,255,255,0.14) ' + progress + '%)' }}
              />
              <span className="w-10 shrink-0 text-right text-[0.625rem] tabular text-ink-2">{duration > 0 ? formatTime(duration) : '—:—'}</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <SongArtwork src={nowPlaying?.thumbnailUrl} className="h-9 w-9" iconSize={14} />
                <div className="min-w-0">
                  <p className="truncate text-[0.75rem] font-semibold text-ink">{nowPlaying?.title ?? 'Nothing playing'}</p>
                  <p className="truncate text-[0.625rem] text-ink-2">
                    {nowPlaying === null ? 'Add a song to take the stage' : (nowPlaying.channelTitle ?? 'YouTube') + ' · Added by ' + nowPlaying.addedBy}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[0.625rem] text-ink-2">
                    <span aria-hidden="true" className={['size-1.5 rounded-full', status.dot].join(' ')} />
                    {status.label}
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
                  // With nothing playing, the first press starts the queue. That is
                  // the console page's "Start the session", which retired with it.
                  disabled={(nowPlaying === null && upNext.length === 0) || busy !== null}
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
                  className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
                >
                  <ArrowsOutIcon size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>

          <div className="party-up-next z-30 shrink-0" aria-hidden={computer} inert={computer}>
            <div className="min-h-0 overflow-hidden">
              <section className="flex items-center justify-between gap-3 border-t border-white/10 px-1 pt-2.5" aria-label="Up next">
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
                  <button
                    type="button"
                    onClick={() => { setLayout('computer'); setTab('queue'); }}
                    className="min-h-11 inline-flex items-center hover:text-ink"
                  >
                    Up next · {upNext.length}
                  </button>
                  {nextSong === null ? null : <span className="hidden sm:block">Starts automatically when this video ends</span>}
                </div>
              </section>
            </div>
          </div>
        </main>

        <div ref={panelRef} className="party-panel" aria-hidden={!computer} inert={!computer}>
          {computer || panelMounted ? (
            <aside className="flex min-h-0 w-full min-w-0 flex-col gap-3 overflow-hidden lg:w-[26rem] lg:overflow-y-auto" aria-label="Stage controls">
              <InviteCard
                roomName={roomName}
                code={code}
                hostName={hostName}
                joinUrl={joinUrl}
                guests={onlineGuestCount(roster)}
                shareReady={connection === 'live'}
                className="shrink-0"
              />

              <div role="tablist" aria-label="Stage panel" className="flex items-center gap-1 rounded-media border border-line bg-surface p-1">
                {(['search', 'queue', 'songbook'] as const).map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={tab === name}
                    onClick={() => setTab(name)}
                    className={[
                      'inline-flex min-h-11 flex-1 items-center justify-center rounded-media text-[0.75rem] font-semibold transition-colors',
                      tab === name ? 'bg-signal-soft text-signal' : 'text-ink-2 hover:text-ink',
                    ].join(' ')}
                  >
                    {name[0].toUpperCase() + name.slice(1)}
                  </button>
                ))}
              </div>

              <section className="rounded-panel border border-line bg-surface p-4" role="tabpanel" aria-label={tab + ' panel'}>
                {tab === 'search' ? (
                  <>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="font-display text-[1.05rem] font-bold tracking-[-0.02em] text-ink">Search and queue</h2>
                      <div className="flex items-center gap-1">
                        {(['grid', 'list'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setDensity(mode)}
                            aria-pressed={density === mode}
                            className={['min-h-9 rounded-media px-2 text-[0.625rem] font-semibold capitalize', density === mode ? 'bg-surface-2 text-signal' : 'text-ink-2 hover:text-ink'].join(' ')}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>
                    <SongSearchPanel
                      roomId={roomId}
                      queue={queue}
                      variant="host"
                      layout={density}
                      initialQuery={searchQuery}
                      onAdded={() => { void refresh(); }}
                      onOpenQueue={() => setTab('queue')}
                      popularSlot={(
                        <PopularSongs
                          roomId={roomId}
                          layout="vertical"
                          queuedVideoIds={queue.map((song) => song.videoId)}
                          onAdded={() => { void refresh(); }}
                        />
                      )}
                    />
                  </>
                ) : null}

                {tab === 'queue' ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-display text-[1.05rem] font-bold tracking-[-0.02em] text-ink">Room queue</h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmClear(true)}
                        disabled={queue.length === 0 || clearing}
                      >
                        Clear queue
                      </Button>
                    </div>
                    <p className="mt-1.5 text-[0.6875rem] leading-[1.55] text-ink-2">
                      Songs play in order, and the next one starts by itself.
                    </p>
                    <div className="mt-3">
                      <UpNextList
                        queue={queue}
                        variant="table"
                        emptyTitle="Queue is empty."
                        emptyDescription="Search first, or hand the code to a phone."
                        onRemove={(songId) => { void removeSong(songId); }}
                        onReorder={(songId, direction) => { void reorderSong(songId, direction); }}
                        onVote={(songId) => { void voteSong(songId); }}
                        votingSongId={votingSongId}
                      />
                    </div>
                  </>
                ) : null}

                {tab === 'songbook' ? (
                  <>
                    <h2 className="font-display text-[1.05rem] font-bold tracking-[-0.02em] text-ink">Karaoke songbook</h2>
                    <p className="mt-1.5 text-[0.6875rem] leading-[1.55] text-ink-2">
                      With lyrics, ready to queue. Songs play from YouTube.
                    </p>
                    <div className="mt-3">
                      <SongbookList
                        api={api}
                        roomId={roomId}
                        channels={CATALOG_CHANNEL_LABELS}
                        canSync
                        columns={1}
                        onAdded={() => { void refresh(); }}
                      />
                    </div>
                  </>
                ) : null}
              </section>
            </aside>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmEnd}
        title="End the room?"
        description="Playback stops, the queue closes, and every remote loses access. This cannot be undone."
        confirmLabel="End the room"
        cancelLabel="Keep it open"
        busy={ending}
        onConfirm={() => { void finishRoom(); }}
        onCancel={() => setConfirmEnd(false)}
      />
      <ConfirmDialog
        open={confirmClear}
        title="Clear the queue?"
        description="Every song is removed, including the one playing, and playback stops. This cannot be undone."
        confirmLabel="Clear queue"
        cancelLabel="Keep the queue"
        busy={clearing}
        onConfirm={() => { void clearQueue(); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
