import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { BellRingingIcon } from '@phosphor-icons/react/dist/csr/BellRinging';
import { LockSimpleIcon } from '@phosphor-icons/react/dist/csr/LockSimple';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { QueueIcon } from '@phosphor-icons/react/dist/csr/Queue';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward';
import { useRoomData } from '../features/rooms/useRoomData';
import GuestSongbook from './GuestSongbook';
import { useRoomApi } from './RoomApiProvider';
import { sendPlaybackCommand } from '../features/playback/playbackApi';
import NowPlayingCard from '../features/queue/NowPlayingCard';
import { UpNextList } from '../features/queue/QueueRows';
import SongSearchPanel from '../features/queue/SongSearchPanel';
import PopularSongs from '../features/queue/PopularSongs';
import { clearGuestToken } from '../features/rooms/tokenStore';
import { touchSession } from '../features/rooms/sessionStore';
import { rememberPlayed, rememberSongs } from '../features/library/libraryStore';
import { QUEUE_ELEMENT_ID } from '../features/queue/queueAnchor';
import { formatTime, queueSummary } from '../lib/format';
import { Avatar, Button, IconButton, Logo, SongArtwork, Toast } from '../ui';

type GuestTab = 'search' | 'queue';

function useGuestTab(): GuestTab {
  const location = useLocation();
  return location.pathname.endsWith('/search') ? 'search' : 'queue';
}

export default function GuestRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const api = useRoomApi();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = useGuestTab();
  // The songbook is a screen inside the remote, not a third remote tab. The
  // shell keeps running here so the session heartbeat and BottomNav survive.
  const songbook = location.pathname.endsWith('/songbook');
  // Neither remote tab owns the songbook, so leave both unselected there.
  const navTab: GuestTab | null = songbook ? null : tab;
  const { data, error, loading, connection, restoredAt, lastLiveAt, refresh } = useRoomData(roomId, 'guest');
  const [toast, setToast] = useState<{ id: number; message: string; detail?: string } | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const seenSongs = useRef(new Set<string>());
  const playedSong = useRef<string | null>(null);
  const touchedRoom = useRef<string | null>(null);

  const queue = useMemo(() => {
    if (data?.queue === undefined) return [];
    return [...data.queue].sort((a, b) => a.position - b.position);
  }, [data?.queue]);
  const nowPlaying = useMemo(() => {
    if (data === null) return null;
    return queue.find((song) => song.status === 'playing')
      ?? queue.find((song) => song.songId === data.playback?.currentSongId)
      ?? null;
  }, [data, queue]);
  const upNext = useMemo(() => queue.filter((song) => song.status !== 'playing'), [queue]);
  const viewer = data?.viewer;
  const room = data?.room;
  const roster = data?.roster ?? [];
  const hostEntry = roster.find((member) => member.role === 'host');
  const hostName = hostEntry?.displayName ?? 'Host';
  const hostOnline = hostEntry?.online === true;
  const roomName = room?.name ?? 'Karaoke room';
  const code = room?.code ?? '';
  const locked = room?.guestControlLocked === true;
  const playbackLocked = room?.guestPlaybackLocked !== false;
  const offline = connection === 'offline' && data !== null;
  const lastKnownDuration = data?.playback?.durationSeconds ?? nowPlaying?.durationSeconds ?? 0;
  const rawPlayback = data?.playback;
  const effectivePlaying = hostOnline && rawPlayback?.isPlaying === true;
  const playback = rawPlayback === undefined
    ? undefined
    : hostOnline
      ? rawPlayback
      : { ...rawPlayback, isPlaying: false };

  const goTab = useCallback((next: GuestTab) => {
    navigate(next === 'search' ? '/room/' + roomId + '/search' : '/room/' + roomId);
  }, [navigate, roomId]);

  useEffect(() => {
    if (data === null || data.status !== 'live' || viewer === undefined) {
      return;
    }
    if (touchedRoom.current === roomId + roomName + hostName) {
      return;
    }
    touchedRoom.current = roomId + roomName + hostName;
    touchSession(roomId, { roomName, hostName });
  }, [data, hostName, roomId, roomName, viewer]);

  useEffect(() => {
    if (restoredAt === null) {
      return;
    }
    setToast({ id: Date.now(), message: 'Connection restored.', detail: 'Same room, same name. No need to rejoin.' });
  }, [restoredAt]);

  useEffect(() => {
    if (nowPlaying === null) {
      return;
    }
    if (playedSong.current === nowPlaying.songId) {
      return;
    }
    playedSong.current = nowPlaying.songId;
    rememberPlayed([nowPlaying]);
  }, [nowPlaying]);

  useEffect(() => {
    const fresh = queue.filter((song) => !seenSongs.current.has(song.videoId));
    if (fresh.length === 0) {
      return;
    }
    for (const song of fresh) {
      seenSongs.current.add(song.videoId);
    }
    rememberSongs(fresh);
  }, [queue]);

  useEffect(() => {
    document.title = roomName.length > 0 ? 'kara-echo · ' + roomName : 'kara-echo | the room sings together';
    return () => {
      document.title = 'kara-echo | the room sings together';
    };
  }, [roomName]);

  async function controlPlayback(action: 'play' | 'pause'): Promise<void> {
    setPlaybackError(null);
    setPlaybackBusy(true);
    try {
      await sendPlaybackCommand(api, roomId, action);
      await refresh();
    } catch (caught) {
      setPlaybackError(caught instanceof Error ? caught.message : 'That playback action failed.');
    } finally {
      setPlaybackBusy(false);
    }
  }

  async function retry(): Promise<void> {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  function leave(): void {
    clearGuestToken(roomId);
    navigate('/');
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-[430px] bg-graphite px-4 py-5 text-ink">
        <span role="status" className="sr-only">Loading the room…</span>
        <div className="skeleton h-8 w-36 rounded" />
        <div className="skeleton mt-6 h-16 w-full rounded-panel" />
        <div className="skeleton mt-5 h-44 w-full rounded-panel" />
        <div className="skeleton mt-4 h-64 w-full rounded-panel" />
      </main>
    );
  }

  if (error !== null && data === null) {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-[430px] place-items-center bg-graphite px-4 text-ink">
        <div className="w-full rounded-panel border border-line bg-surface p-5">
          <Logo size="sm" />
          <h1 className="mt-5 font-display text-[1.8rem] font-bold tracking-[-0.02em]">Room unavailable.</h1>
          <p role="alert" className="mt-3 rounded-media border border-danger/30 bg-danger-soft/50 px-3.5 py-2.5 text-[0.8125rem] text-danger">{error}</p>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" size="sm" icon={<ArrowClockwiseIcon size={14} />} onClick={() => void retry()} busy={retrying}>Try again</Button>
            <Button variant="quiet" size="sm" onClick={() => navigate('/')}>Back home</Button>
          </div>
        </div>
      </main>
    );
  }

  if (data === null || data.status === 'ended') {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-[430px] place-items-center bg-graphite px-4 text-ink">
        <div className="w-full rounded-panel border border-line bg-surface p-5">
          <Logo size="sm" />
          <h1 className="mt-5 font-display text-[1.8rem] font-bold tracking-[-0.02em]">This room has ended.</h1>
          <p role="status" className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">The host closed the session. Thanks for singing.</p>
          <Button variant="primary" size="sm" className="mt-4" onClick={() => navigate('/')}>Start another room</Button>
        </div>
      </main>
    );
  }

  const header = (
    <header className="sticky top-0 z-30 border-b border-line bg-graphite/95 backdrop-blur">
      <div className="mx-auto w-full max-w-[430px] px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <Logo size="sm" />
          <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium">
            <span
              aria-hidden="true"
              className={[
                'size-1.5 rounded-full',
                offline ? 'bg-gold' : connection === 'live' ? 'animate-presence-pulse bg-live' : 'bg-ink-3',
              ].join(' ')}
            />
            <span className={offline ? 'text-gold' : 'text-live'}>
              {offline ? 'Reconnecting' : connection === 'live' ? 'Connected' : 'Connecting'}
            </span>
          </span>
        </div>
        <div className="mt-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-display text-[1.65rem] font-bold leading-[1.1] tracking-[-0.03em] text-ink">{roomName}</h1>
            <p className="mt-1 truncate text-[0.6875rem] text-ink-2">Hosted by {hostName} · {formatCode(code)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-2">
              <Avatar name={viewer?.displayName ?? 'Guest'} size="sm" />
              <span className="max-w-[6rem] truncate text-[0.75rem] text-ink">{viewer?.displayName ?? 'Guest'}</span>
            </div>
            <IconButton
              icon={<SignOutIcon size={16} />}
              label="Leave room"
              tone="ghost"
              size="sm"
              placement="bottom"
              className="size-11"
              onClick={leave}
            />
          </div>
        </div>
      </div>
      {locked ? (
        <p className="flex items-center justify-center gap-1.5 border-t border-line bg-surface px-4 py-2 text-[0.6875rem] text-ink-2">
          <LockSimpleIcon size={13} aria-hidden="true" />
          Guest requests are off. The host is in control.
        </p>
      ) : null}
    </header>
  );

  if (offline) {
    return (
      <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-graphite pb-24 text-ink">
        {header}
        <main className="page-enter px-4 pb-8 pt-6">
          <p className="eyebrow text-gold">Connection lost</p>
          <h2 className="mt-1 font-display text-[2rem] font-bold leading-[1.03] tracking-[-0.035em]">Finding the room again.</h2>
          <p className="mt-2 text-[0.8125rem] leading-[1.65] text-ink-2">
            {hostOnline
              ? 'Playback continues on ' + hostName + "'s screen while we reconnect you."
              : 'The host screen is offline too. Playback is paused until it returns.'}
          </p>

          <section className="mt-5 rounded-panel border border-line bg-surface p-4" aria-label="Stale queue">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow text-ink-2">Stale queue</p>
              <span className="text-[0.625rem] text-ink-3">
                {lastLiveAt === null ? 'Last known' : 'Last seen ' + new Date(lastLiveAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
            <p className="mt-2 text-[0.6875rem] text-ink-2">
              Last known: {nowPlaying === null ? 'nothing playing' : nowPlaying.title}
              {nowPlaying === null ? '' : ' · ' + formatTime(recordingPosition(data.playback)) + ' / ' + (lastKnownDuration > 0 ? formatTime(lastKnownDuration) : '—:—')}
            </p>
            <ol className="mt-3 divide-y divide-line">
              {upNext.slice(0, 4).map((song, index) => (
                <li key={song.songId} className="flex items-center gap-3 py-2.5">
                  <span className="w-4 text-[0.625rem] tabular text-ink-3">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.75rem] text-ink">{song.title}</span>
                  <span className="text-[0.625rem] text-ink-3">{song.addedBy}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {['Add', 'Pause', 'Skip'].map((label) => (
              <button
                key={label}
                type="button"
                disabled
                className="min-h-11 rounded-media border border-line bg-surface-2 text-[0.75rem] font-semibold text-ink-2 opacity-45"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[0.6875rem] leading-[1.6] text-ink-2">
            {hostOnline
              ? 'Room commands are disabled while offline. The host screen keeps playing.'
              : 'Room commands are disabled while offline. Playback resumes when the host screen returns.'}
          </p>

          <Button
            variant="primary"
            size="lg"
            full
            className="mt-4"
            icon={<ArrowClockwiseIcon size={16} className={retrying ? 'animate-spin' : ''} />}
            busy={retrying}
            onClick={() => void retry()}
          >
            Retry connection
          </Button>
          <div className="mt-4 flex items-center justify-between gap-2 text-[0.75rem]">
            <Link to={'/join/' + code} className="inline-flex min-h-11 items-center text-ink-2 hover:text-ink">Use room code instead</Link>
            <span className="font-mono text-[0.6875rem] tracking-[0.06em] text-signal">{formatCode(code)}</span>
          </div>
          <p className="mt-4 text-[0.6875rem] leading-[1.6] text-ink-3">
            Your room, identity and queue are kept. Once restored you will land back here with no need to join again.
          </p>
        </main>
        <BottomNav tab={navTab} queueCount={queue.length} roomId={roomId} />
      </div>
    );
  }

  const nextSong = upNext[0] ?? null;
  const myNextIndex = upNext.findIndex((song) => song.memberId === viewer?.memberId);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-graphite pb-24 text-ink">
      {header}

      {songbook ? (
        <main key="songbook" className="page-enter px-4 pb-8 pt-6">
          <GuestSongbook roomId={roomId} locked={locked} onAdded={() => { void refresh(); }} />
        </main>
      ) : tab === 'search' ? (
        <main key="search" className="page-enter px-4 pb-8 pt-6">
          <p className="eyebrow text-gold">Song discovery</p>
          <h2 className="mt-1 font-display text-[2rem] font-bold leading-[1.03] tracking-[-0.035em]">Pick your next song.</h2>
          <p className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
            {locked ? 'Search is open. The host turned off new requests.' : 'Search YouTube. Add to the room queue.'}
          </p>

          {nowPlaying !== null ? (
            <div className="mt-4 flex items-center gap-3 rounded-media border border-line bg-surface px-3 py-2.5">
              <SongArtwork src={nowPlaying.thumbnailUrl} className="h-10 w-10" iconSize={14} />
              <div className="min-w-0 flex-1">
                <p className="eyebrow text-gold">{hostOnline ? 'Playing on host screen' : 'Host screen offline'}</p>
                <p className="mt-0.5 truncate text-[0.75rem] text-ink">
                  {nowPlaying.title} · {nowPlaying.channelTitle ?? 'YouTube'}
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-5">
            <SongSearchPanel
              roomId={roomId}
              queue={queue}
              variant="guest"
              disabled={locked}
              onAdded={() => { void refresh(); }}
              onOpenQueue={() => goTab('queue')}
              popularSlot={(
                <PopularSongs
                  roomId={roomId}
                  disabled={locked}
                  queuedVideoIds={queue.map((song) => song.videoId)}
                  moreHref={'/room/' + roomId + '/songbook'}
                  onAdded={() => { void refresh(); }}
                />
              )}
            />
          </div>
        </main>
      ) : (
        <main key="queue" className="page-enter px-4 pb-8 pt-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow text-gold">Shared playlist</p>
              <h2 className="mt-1 font-display text-[2rem] font-bold leading-[1.03] tracking-[-0.035em]">The room queue.</h2>
            </div>
            <span className="text-[0.625rem] text-ink-2">{queueSummary(queue)}</span>
          </div>

          <div className="mt-4">
            <NowPlayingCard
              song={nowPlaying}
              playback={playback}
              variant="guest"
              emptyTitle="The stage is quiet."
              emptyDescription="No video is playing yet. Add the first song from Search."
              emptyAction={<Button variant="secondary" size="sm" className="min-h-11" icon={<MagnifyingGlassIcon size={14} />} onClick={() => goTab('search')}>Search songs</Button>}
            />
          </div>

          <section className="mt-3 rounded-panel border border-line bg-surface p-3.5" aria-label="Playback controls">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <LockSimpleIcon size={14} className="mt-0.5 shrink-0 text-ink-2" aria-hidden="true" />
                <div>
                  <p className="text-[0.6875rem] font-semibold text-ink">
                    {playbackLocked ? 'Playback is host-only' : 'You can pause and resume'}
                  </p>
                  <p className="mt-0.5 text-[0.625rem] text-ink-2">
                    {playbackLocked ? hostName + ' controls pause, skip and moderation.' : 'Skip and moderation stay with the host.'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void controlPlayback(data.playback?.isPlaying === true ? 'pause' : 'play')}
                  disabled={playbackLocked || !hostOnline || nowPlaying === null || playbackBusy || offline}
                  aria-label={effectivePlaying ? 'Pause playback' : 'Resume playback'}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-media border border-line bg-surface-2 px-2.5 text-[0.6875rem] font-semibold text-ink disabled:pointer-events-none disabled:opacity-35"
                >
                  {playbackBusy ? <ArrowClockwiseIcon size={13} className="animate-spin" aria-hidden="true" /> : effectivePlaying ? <PauseIcon size={13} weight="fill" aria-hidden="true" /> : <PlayIcon size={13} weight="fill" aria-hidden="true" />}
                  {effectivePlaying ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  disabled
                  aria-label="Skip song, host only"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-media border border-line bg-surface-2 px-2.5 text-[0.6875rem] font-semibold text-ink opacity-40"
                >
                  <SkipForwardIcon size={13} weight="fill" aria-hidden="true" />
                  Skip
                </button>
              </div>
            </div>
            {playbackError === null ? null : (
              <p role="alert" className="mt-2 rounded-media border border-danger/30 bg-danger-soft/50 px-3 py-2 text-[0.6875rem] text-danger">{playbackError}</p>
            )}
          </section>

          {nowPlaying !== null ? (
            <div className="mt-3 flex items-start gap-2 rounded-media border border-signal/20 bg-signal-soft/50 px-3.5 py-3">
              <ArrowRightIcon size={14} className="mt-0.5 shrink-0 text-signal" aria-hidden="true" />
              <p className="text-[0.6875rem] leading-[1.6] text-ink-2">
                {hostOnline ? (
                  <>
                    <span className="font-semibold text-signal">Automatic advance is on.</span>{' '}
                    {nextSong === null
                      ? 'The room will wait for the next request when this video ends.'
                      : 'When the current YouTube video ends, ' + nextSong.title + ' starts automatically on the host screen.'}
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-ink">The host screen is offline.</span>{' '}
                    Playback is paused and will not advance until it returns.
                  </>
                )}
              </p>
            </div>
          ) : null}

          {myNextIndex === 0 && upNext[0] !== undefined ? (
            <section className="mt-4 overflow-hidden rounded-panel border border-signal/30 bg-signal-soft" aria-labelledby="your-turn">
              <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
                <p className="inline-flex items-center gap-1.5 eyebrow text-signal">
                  <BellRingingIcon size={12} aria-hidden="true" />
                  Your next turn
                </p>
                <span className="text-[0.625rem] text-signal">Next in line</span>
              </div>
              <div className="px-4 pb-4 pt-3">
                <h3 id="your-turn" className="font-display text-[1.45rem] font-bold leading-[1.1] tracking-[-0.02em] text-ink">
                  {viewer?.displayName ?? 'You'}, you're up next.
                </h3>
                <p className="mt-1 text-[0.6875rem] text-ink-2">
                  {nowPlaying === null ? 'Your song is first in line.' : 'Your song follows ' + nowPlaying.title + '.'}
                </p>
                <div className="mt-3 flex items-center gap-3 rounded-media border border-signal/20 bg-graphite/35 p-2.5">
                  <SongArtwork src={upNext[0].thumbnailUrl} className="h-11 w-11" iconSize={15} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem] font-semibold text-ink">{upNext[0].title}</p>
                    <p className="mt-0.5 truncate text-[0.625rem] text-ink-2">
                      {upNext[0].channelTitle ?? 'YouTube'}
                      {upNext[0].durationSeconds === null ? '' : ' · ' + formatTime(upNext[0].durationSeconds)}
                    </p>
                  </div>
                </div>
                <p className="mt-2.5 text-[0.6875rem] leading-[1.6] text-ink-2">
                  {hostOnline
                    ? 'Get ready for the host screen. Your YouTube video starts there automatically when this song ends.'
                    : 'The host screen is offline. Your song is still next when it returns.'}
                </p>
              </div>
            </section>
          ) : null}

          <section className="mt-5" aria-labelledby="guest-up-next">
            <div className="flex items-end justify-between gap-2">
              <div>
                <p id="guest-up-next" className="eyebrow text-ink-2">Up next</p>
                <p className="mt-1 text-[0.6875rem] text-ink-2">
                  {upNext.length === 0 ? 'Nothing waiting.' : queueSummary(upNext)}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="min-h-11" icon={<MagnifyingGlassIcon size={13} />} onClick={() => goTab('search')}>
                Add songs
              </Button>
            </div>
            <div className="mt-3 rounded-panel border border-line bg-surface px-4 py-2">
              <UpNextList
                queue={upNext}
                variant="guest"
                listId={QUEUE_ELEMENT_ID}
                viewerMemberId={viewer?.memberId}
                emptyTitle="The queue is waiting."
                emptyDescription="Be the one who picks the next song."
                emptyAction={<Button variant="primary" size="sm" className="min-h-11" icon={<MagnifyingGlassIcon size={13} />} onClick={() => goTab('search')}>Search songs</Button>}
              />
            </div>
          </section>
        </main>
      )}

      <BottomNav tab={navTab} queueCount={queue.length} roomId={roomId} />

      {toast === null ? null : (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4">
          <Toast
            key={toast.id}
            message={toast.message}
            detail={toast.detail}
            tone="success"
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}

function recordingPosition(playback: { positionSeconds: number } | undefined): number {
  return playback?.positionSeconds ?? 0;
}

function formatCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

function BottomNav({
  tab,
  queueCount,
  roomId,
}: {
  tab: GuestTab | null;
  queueCount: number;
  roomId: string;
}) {
  return (
    <nav
      aria-label="Remote sections"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[430px] border-t border-line bg-graphite-deep/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur"
    >
      <div className="grid grid-cols-2 gap-2">
        <Link
          to={'/room/' + roomId + '/search'}
          aria-current={tab === 'search' ? 'page' : undefined}
          className={[
            'flex min-h-11 items-center justify-center gap-2 rounded-media text-[0.75rem] font-semibold transition-[background-color,color,transform,scale] duration-150 active:scale-[0.98]',
            tab === 'search' ? 'bg-surface text-signal' : 'text-ink-2 hover:bg-surface hover:text-ink',
          ].join(' ')}
        >
          <MagnifyingGlassIcon size={16} weight={tab === 'search' ? 'fill' : 'regular'} aria-hidden="true" />
          Search
        </Link>
        <Link
          to={'/room/' + roomId}
          aria-current={tab === 'queue' ? 'page' : undefined}
          className={[
            'flex min-h-11 items-center justify-center gap-2 rounded-media text-[0.75rem] font-semibold transition-[background-color,color,transform,scale] duration-150 active:scale-[0.98]',
            tab === 'queue' ? 'bg-surface text-signal' : 'text-ink-2 hover:bg-surface hover:text-ink',
          ].join(' ')}
        >
          <QueueIcon size={16} weight={tab === 'queue' ? 'fill' : 'regular'} aria-hidden="true" />
          Queue · {queueCount}
        </Link>
      </div>
    </nav>
  );
}
