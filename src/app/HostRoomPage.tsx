import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { useRoomData } from '../features/rooms/useRoomData';
import { useRoomApi } from './RoomApiProvider';
import {
  approveMember,
  rejectMember,
  removeRoomMember,
  sendHostCommand,
  transferRoomTo,
  type HostAction,
} from '../features/rooms/roomApi';
import { removeSong as removeQueueSong, reorderSong as reorderQueueSong, voteSong as castVote, describeVoteError } from '../features/queue/queueApi';
import { sendPlaybackCommand, reportPlaybackPosition } from '../features/playback/playbackApi';
import HostPlayer from '../features/playback/HostPlayer';
import PlayerDock from '../features/playback/PlayerDock';
import Sidebar, { type SidebarNav } from '../features/rooms/Sidebar';
import { buildJoinUrl } from '../features/rooms/roomUrl';
import { loadHostToken } from '../features/rooms/tokenStore';
import { rememberSession, forgetSession } from '../features/rooms/sessionStore';
import { rememberPlayed, rememberSongs } from '../features/library/libraryStore';
import { groupRoomCode, presenceSummary } from '../lib/format';
import { Button, Chip, IconButton, Logo, Toast, type ToastTone } from '../ui';
import type { HostNotify, HostRoomContext } from './useHostRoom';

export type { HostNotify, HostRoomContext } from './useHostRoom';

function navFor(pathname: string): SidebarNav {
  if (pathname.endsWith('/host/queue')) return 'queue';
  if (pathname.endsWith('/host/settings')) return 'settings';
  if (pathname.endsWith('/host/library')) return 'library';
  if (pathname.endsWith('/host/favorites')) return 'favorites';
  if (pathname.endsWith('/host/recent')) return 'recent';
  if (pathname.endsWith('/host/songbook')) return 'songbook';
  return 'discover';
}

export default function HostRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const api = useRoomApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error, loading, connection, restoredAt, refresh } = useRoomData(roomId, 'host');
  const [toast, setToast] = useState<{ id: number; message: string; detail?: string; tone: ToastTone } | null>(null);
  const [doorBusyId, setDoorBusyId] = useState<string | null>(null);
  const playbackBusy = useRef(false);
  const advanceBusy = useRef(false);
  const playbackSettled = useRef<Promise<void> | null>(null);
  const autoAdvance = useRef<{ songId: string; promise: Promise<boolean> } | null>(null);
  const lastAutoAdvance = useRef<string | null>(null);
  const reportFailures = useRef(0);
  const seenSongs = useRef(new Set<string>());
  const playedSong = useRef<string | null>(null);
  const rememberedRoom = useRef<string | null>(null);
  const exitSentRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const wasLiveRef = useRef(false);
  const roomClosedRef = useRef(false);
  const canPauseRoom = useCallback(
    (): boolean => !roomClosedRef.current && loadHostToken(roomId) !== null,
    [roomId],
  );
  const lastAutoPlayKey = useRef<string | null>(null);
  const queueInitialized = useRef(false);

  // Hosts arrive here from the home page, which may be scrolled; without this
  // the room opens mid-page with its hero banner cut off.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [roomId]);

  useEffect(() => {
    // A cleanup that is immediately followed by the next setup is the
    // StrictMode development probe. The deferred pause lets that setup cancel
    // it, while a real unmount has no next setup and still pauses the room.
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    exitSentRef.current = false;
    const pauseOnExit = (options?: { keepalive?: boolean }): void => {
      if (exitSentRef.current) {
        return;
      }
      exitSentRef.current = true;
      // Both exit pauses mean the same thing: this device is stopping the only
      // player. Neither is worth sending once the room has ended or this tab no
      // longer holds a host pass — those answer 409 and 403 as console noise for a
      // refusal that is correct.
      if (!canPauseRoom()) {
        return;
      }
      // Leaving this route destroys the only player. Pause even if the last
      // poll looked paused: a guest may have started playback since then.
      void sendPlaybackCommand(api, roomId, 'pause', options).catch(() => undefined);
    };
    const onPageHide = (): void => pauseOnExit({ keepalive: true });
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        pauseOnExit();
      }, 0);
    };
  }, [api, canPauseRoom, roomId]);

  const notify = useCallback<HostNotify>((message, detail, tone = 'success') => {
    setToast({ id: Date.now(), message, detail, tone });
  }, []);

  const room = data !== null && data.status === 'live' ? data.room : undefined;
  const live = data !== null && data.status === 'live' && room !== undefined;

  useEffect(() => {
    // An ended room has no playback left to pause, and a tab without a host pass
    // cannot pause one, so only a room that stopped being live for some other
    // reason while this device still commands it is worth a final pause command.
    if (wasLiveRef.current && !live && data?.status !== 'ended' && canPauseRoom()) {
      void sendPlaybackCommand(api, roomId, 'pause').catch(() => undefined);
    }
    wasLiveRef.current = live;
  }, [api, canPauseRoom, data?.status, live, roomId]);

  const queue = useMemo(() => {
    if (!live) return [];
    return [...(data.queue ?? [])].sort((a, b) => a.position - b.position);
  }, [data, live]);
  const nowPlaying = useMemo(() => {
    if (!live) return null;
    return queue.find((song) => song.status === 'playing')
      ?? queue.find((song) => song.songId === data.playback?.currentSongId)
      ?? null;
  }, [data, live, queue]);
  const upNext = useMemo(() => queue.filter((song) => song.status !== 'playing'), [queue]);
  const roster = live ? (data.roster ?? []) : [];
  const door = live ? (data.door ?? []) : [];
  const hostName = roster.find((member) => member.role === 'host')?.displayName?.trim() || 'Host';
  const roomName = room?.name ?? 'Karaoke room';
  const code = room?.code ?? '';
  const joinUrl = code.length > 0 ? buildJoinUrl(window.location.origin, code) : '';

  const runPlayback = useCallback(async (action: 'play' | 'pause' | 'next', expectedSongId?: string): Promise<boolean> => {
    if (playbackBusy.current) {
      if (action !== 'next' || playbackSettled.current === null) return false;
      // Wait for a concurrent play/pause to settle rather than treating a
      // legitimate end-of-song event as an immediate playback failure.
      await playbackSettled.current;
      if (playbackBusy.current) return false;
    }
    let settle: () => void = () => undefined;
    playbackSettled.current = new Promise<void>((resolve) => { settle = resolve; });
    playbackBusy.current = true;
    try {
      await sendPlaybackCommand(api, roomId, action, undefined, expectedSongId);
      await refresh();
      return true;
    } catch (caught) {
      notify(
        action === 'next' ? 'That song could not be skipped.' : 'Playback did not change.',
        caught instanceof Error ? caught.message : undefined,
        'error',
      );
      if (action === 'next' && expectedSongId === undefined) {
        // If advancing failed, try to leave the room in a paused state rather
        // than letting every phone believe a finished video is still playing.
        try {
          await sendPlaybackCommand(api, roomId, 'pause');
          await refresh();
        } catch {
          // The same outage that blocked the advance will often block this too.
        }
      }
      return false;
    } finally {
      playbackBusy.current = false;
      playbackSettled.current = null;
      settle();
    }
  }, [api, notify, refresh, roomId]);

  const openPartyView = useCallback((): void => {
    if (location.pathname.endsWith('/host/stage') || location.pathname.endsWith('/host/party')) {
      return;
    }
    navigate('/room/' + roomId + '/host/party');
  }, [location.pathname, navigate, roomId]);

  const runManualNext = useCallback(async (): Promise<boolean> => {
    if (advanceBusy.current) return false;
    advanceBusy.current = true;
    try {
      return await runPlayback('next');
    } finally {
      window.setTimeout(() => {
        advanceBusy.current = false;
      }, 800);
    }
  }, [runPlayback]);

  const next = useCallback((expectedSongId?: string | null): Promise<boolean> => {
    if (expectedSongId !== null && expectedSongId !== undefined) {
      if (lastAutoAdvance.current === expectedSongId) return Promise.resolve(true);
      const inFlight = autoAdvance.current;
      if (inFlight !== null && inFlight.songId === expectedSongId) return inFlight.promise;
      const task = runPlayback('next', expectedSongId).then((success) => {
        if (success) lastAutoAdvance.current = expectedSongId;
        return success;
      }).finally(() => {
        if (autoAdvance.current?.promise === task) autoAdvance.current = null;
      });
      autoAdvance.current = { songId: expectedSongId, promise: task };
      return task;
    }
    return runManualNext();
  }, [runManualNext, runPlayback]);

  const togglePlay = useCallback(async (): Promise<void> => {
    await runPlayback(data?.playback?.isPlaying === true ? 'pause' : 'play');
  }, [data?.playback?.isPlaying, runPlayback]);

  const runHost = useCallback(async (action: HostAction): Promise<boolean> => {
    try {
      await sendHostCommand(api, roomId, action);
      await refresh();
      return true;
    } catch (caught) {
      notify('That room command failed.', caught instanceof Error ? caught.message : undefined, 'error');
      return false;
    }
  }, [api, notify, refresh, roomId]);

  const removeSong = useCallback(async (songId: string): Promise<void> => {
    try {
      await removeQueueSong(api, roomId, songId);
      await refresh();
      notify('Song removed.', undefined, 'info');
    } catch (caught) {
      notify('The song could not be removed.', caught instanceof Error ? caught.message : undefined, 'error');
    }
  }, [api, notify, refresh, roomId]);

  const reorderSong = useCallback(async (songId: string, direction: 'up' | 'down'): Promise<void> => {
    try {
      await reorderQueueSong(api, roomId, songId, direction);
      await refresh();
    } catch (caught) {
      notify('The queue could not be reordered.', caught instanceof Error ? caught.message : undefined, 'error');
    }
  }, [api, notify, refresh, roomId]);

  const [votingSongId, setVotingSongId] = useState<string | null>(null);

  const voteSong = useCallback(async (songId: string): Promise<void> => {
    if (votingSongId !== null) return;
    setVotingSongId(songId);
    try {
      await castVote(api, roomId, songId);
      // The read carries this member's own vote, so the pressed state survives
      // the refresh instead of living in a click handler.
      await refresh();
    } catch (caught) {
      notify('That vote could not be counted.', describeVoteError(caught), 'error');
    } finally {
      setVotingSongId(null);
    }
  }, [api, notify, refresh, roomId, votingSongId]);

  const removeMember = useCallback(async (memberId: string): Promise<void> => {
    try {
      await removeRoomMember(api, roomId, memberId);
      await refresh();
      notify('Guest removed.', 'Their queued songs and votes were removed too.', 'info');
    } catch (caught) {
      notify('The guest could not be removed.', caught instanceof Error ? caught.message : undefined, 'error');
    }
  }, [api, notify, refresh, roomId]);

  const doorBusy = useRef(false);

  const approveGuest = useCallback(async (memberId: string): Promise<void> => {
    if (doorBusy.current) return;
    doorBusy.current = true;
    setDoorBusyId(memberId);
    try {
      await approveMember(api, roomId, memberId);
      notify('They are in.');
      await refresh();
    } catch (caught) {
      notify('That guest could not be admitted.', caught instanceof Error ? caught.message : undefined, 'error');
    } finally {
      doorBusy.current = false;
      setDoorBusyId(null);
    }
  }, [api, notify, refresh, roomId]);

  const rejectGuest = useCallback(async (memberId: string): Promise<void> => {
    if (doorBusy.current) return;
    doorBusy.current = true;
    setDoorBusyId(memberId);
    try {
      await rejectMember(api, roomId, memberId);
      notify('They were turned away.');
      await refresh();
    } catch (caught) {
      notify('That guest could not be turned away.', caught instanceof Error ? caught.message : undefined, 'error');
    } finally {
      doorBusy.current = false;
      setDoorBusyId(null);
    }
  }, [api, notify, refresh, roomId]);

  const transferRoom = useCallback(async (memberId: string): Promise<void> => {
    try {
      const transferred = await transferRoomTo(api, roomId, memberId);
      // The stored session said "you host this room". Leaving it that way would
      // send this browser back to a host screen it no longer has a pass for.
      rememberSession({
        roomId,
        code,
        roomName,
        hostName: transferred.newHost.displayName,
        role: 'guest',
      });
      navigate('/room/' + roomId);
      notify(
        'The room is ' + transferred.newHost.displayName + '’s now.',
        'You are a guest: you can still add and vote, but playback is theirs.',
        'info',
      );
    } catch (caught) {
      notify('The room could not be transferred.', caught instanceof Error ? caught.message : undefined, 'error');
    }
  }, [api, code, navigate, notify, roomId, roomName]);

  const endRoom = useCallback(async (): Promise<void> => {
    try {
      await sendHostCommand(api, roomId, 'end');
      roomClosedRef.current = true;
      // An ended room is not an offer any more, and the last-room pointer must
      // not lead back into it.
      forgetSession(roomId);
      // The landing page owns the toast slot this screen would have used, and
      // it unmounts with this navigation, so the acknowledgment travels with it.
      navigate('/', { state: { endedRoom: roomName } });
    } catch (caught) {
      notify('The room could not be ended.', caught instanceof Error ? caught.message : undefined, 'error');
    }
  }, [api, navigate, notify, roomId, roomName]);

  const onReport = useCallback((seconds: number, duration: number, songId: string | null): void => {
    void reportPlaybackPosition(api, roomId, seconds, duration > 0 ? duration : undefined, songId)
      .then(() => {
        reportFailures.current = 0;
      })
      .catch(() => {
        reportFailures.current += 1;
        if (reportFailures.current === 3) {
          notify('Playback sync is failing.', 'Phones may show a stale time until the connection recovers.', 'error');
        }
      });
  }, [api, notify, roomId]);

  const onFindAlternative = useCallback((query: string): void => {
    navigate('/room/' + roomId + '/host?q=' + encodeURIComponent(query));
  }, [navigate, roomId]);

  useEffect(() => {
    if (!live || rememberedRoom.current === roomId) {
      return;
    }
    rememberedRoom.current = roomId;
    rememberSession({
      roomId,
      code,
      roomName,
      hostName,
      role: 'host',
    });
  }, [code, hostName, live, roomId, roomName]);

  useEffect(() => {
    if (restoredAt === null) {
      return;
    }
    notify('Connection restored.', 'The room is still here. No need to rejoin.', 'success');
  }, [notify, restoredAt]);

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
    if (!live) {
      return;
    }
    const fresh = queue.filter((song) => !seenSongs.current.has(song.videoId));
    if (!queueInitialized.current) {
      // A host opening the room with an existing queue should not be pulled
      // away from the page they chose; only songs added after this point do.
      for (const song of fresh) {
        seenSongs.current.add(song.videoId);
      }
      if (fresh.length > 0) {
        rememberSongs(fresh);
      }
      queueInitialized.current = true;
      return;
    }
    if (fresh.length === 0) {
      return;
    }
    for (const song of fresh) {
      seenSongs.current.add(song.videoId);
    }
    rememberSongs(fresh);
    openPartyView();
  }, [openPartyView, live, queue]);

  useEffect(() => {
    document.title = roomName.length > 0 ? 'kara-echo · ' + roomName : 'kara-echo | the room sings together';
    return () => {
      document.title = 'kara-echo | the room sings together';
    };
  }, [roomName]);

  useEffect(() => {
    if (!live) {
      lastAutoPlayKey.current = null;
      return;
    }
    if (data.playback?.isPlaying === true) return;
    if (data.playback?.currentSongId != null) return;
    if (queue.length === 0) {
      lastAutoPlayKey.current = null;
      return;
    }
    // One automatic attempt per new head of a stopped queue. A failed attempt
    // leaves the visible Start playback control instead of retrying forever.
    const key = queue[0].songId;
    if (lastAutoPlayKey.current === key) return;
    lastAutoPlayKey.current = key;
    // A guest's first request should take the host screen straight into party
    // view; the manual "Take the stage" button is only a fallback.
    void runPlayback('play');
    openPartyView();
  }, [openPartyView, live, data?.playback, queue, runPlayback]);

  if (loading) {
    return (
      <main className="min-h-dvh bg-graphite px-4 py-7 text-ink lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
        <span role="status" className="sr-only">Loading host controls…</span>
        <div className="hidden border-r border-line lg:block" />
        <div className="mx-auto w-full max-w-[1180px]">
          <div className="skeleton h-16 w-full rounded-panel" />
          <div className="skeleton mt-5 h-[28rem] w-full rounded-panel" />
        </div>
      </main>
    );
  }

  if (error !== null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <Logo size="sm" />
          <h1 className="mt-6 font-display text-[1.9rem] font-bold tracking-[-0.02em]">Host controls unavailable.</h1>
          <p role="alert" className="mt-3 rounded-media border border-danger/30 bg-danger-soft/50 px-3.5 py-2.5 text-[0.8125rem] text-danger">{error}</p>
          <Link to="/" className="mt-4 inline-flex text-[0.8125rem] font-semibold text-signal hover:underline">
            Back to start
          </Link>
        </div>
      </main>
    );
  }

  if (data === null || data.status === 'ended') {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <Logo size="sm" />
          <h1 className="mt-6 font-display text-[1.9rem] font-bold tracking-[-0.02em]">This room has ended.</h1>
          <p role="status" className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
            Nobody can join after the host closes the room. Start another and pass the mic.
          </p>
          <Button variant="primary" size="md" className="mt-5" onClick={() => navigate('/create')}>Start another room</Button>
        </div>
      </main>
    );
  }

  if (!live || room === undefined) {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <Logo size="sm" />
          <h1 className="mt-6 font-display text-[1.9rem] font-bold tracking-[-0.02em]">Room unavailable.</h1>
          <p role="status" className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
            This room could not be loaded. It may have ended or been cleaned up.
          </p>
          <Button variant="primary" size="md" className="mt-5" onClick={() => navigate('/')}>Back home</Button>
        </div>
      </main>
    );
  }

  const stageRoute = location.pathname.endsWith('/host/stage');
  const partyRoute = location.pathname.endsWith('/host/party');
  const immersive = stageRoute || partyRoute;
  const activeNav = navFor(location.pathname);
  const context: HostRoomContext = {
    roomId,
    room,
    roomName,
    code,
    hostName,
    joinUrl,
    roster,
    door,
    doorBusyId,
    queue,
    nowPlaying,
    upNext,
    playback: data.playback,
    connection,
    notify,
    refresh,
    runHost,
    togglePlay,
    next,
    removeSong,
    reorderSong,
    voteSong,
    votingSongId,
    removeMember,
    approveGuest,
    rejectGuest,
    transferRoom,
    endRoom,
  };

  const toastNode = toast === null ? null : (
    <div className={['pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4', immersive ? 'bottom-6' : 'bottom-[7.5rem] lg:bottom-[6.5rem]'].join(' ')}>
      <Toast
        key={toast.id}
        message={toast.message}
        detail={toast.detail}
        tone={toast.tone}
        onDismiss={() => setToast(null)}
      />
    </div>
  );

  if (immersive) {
    return (
      <HostPlayer
        key={roomId}
        playback={data.playback}
        nowPlaying={nowPlaying}
        onNext={next}
        onReport={onReport}
        onFindAlternative={onFindAlternative}
      >
        <Outlet context={context} />
        {toastNode}
      </HostPlayer>
    );
  }

  return (
    <HostPlayer
      key={roomId}
      playback={data.playback}
      nowPlaying={nowPlaying}
      onNext={next}
      onReport={onReport}
      onFindAlternative={onFindAlternative}
    >
      <div className="min-h-dvh bg-graphite lg:flex">
        <Sidebar
          activeNav={activeNav}
          activeRoom={{ roomId, name: roomName, code, hostName }}
          hostName={hostName}
        />
        <div className="min-w-0 flex-1">
          <header className="relative z-30 border-b border-line bg-graphite/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <Link to="/" className="inline-flex min-h-6 min-w-6 items-center justify-center lg:hidden" aria-label="kara-echo home">
                  <Logo size="sm" withWordmark={false} />
                </Link>
                <div className="min-w-0">
                  <p className="eyebrow text-gold">YouTube karaoke room</p>
                  <h1 className="mt-0.5 truncate font-display text-[1.45rem] font-bold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[1.55rem]">
                    {roomName}
                  </h1>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {connection === 'offline' ? (
                  <Chip tone="gold">Reconnecting</Chip>
                ) : (
                  <span className="hidden items-center gap-2 text-[0.6875rem] text-ink-2 sm:flex">
                    <span aria-hidden="true" className="animate-presence-pulse size-1.5 rounded-full bg-live" />
                    {groupRoomCode(code)} · {presenceSummary(roster)}
                  </span>
                )}
                {door.length === 0 ? null : (
                  <Chip tone="gold">{door.length} at the door</Chip>
                )}
                <Link
                  to={'/room/' + roomId + '/host/party'}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-media border border-line bg-surface px-3 text-[0.75rem] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <ArrowsOutIcon size={14} aria-hidden="true" />
                  Party view
                </Link>
                <Link
                  to={'/room/' + roomId + '/host/settings'}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-media border border-line bg-surface px-3 text-[0.75rem] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <SlidersHorizontalIcon size={14} aria-hidden="true" />
                  Room settings
                </Link>
                <IconButton
                  icon={<SignOutIcon size={17} weight="regular" />}
                  label="Back to home"
                  tone="ghost"
                  size="sm"
                  placement="bottom"
                  onClick={() => navigate('/')}
                />
              </div>
            </div>
            <nav aria-label="Room sections" className="lg:hidden">
              <div className="no-scrollbar mx-auto flex max-w-[1240px] gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
                {[
                  { label: 'Discover', href: '/room/' + roomId + '/host' },
                  { label: 'Queue', href: '/room/' + roomId + '/host/queue' },
                  { label: 'Library', href: '/room/' + roomId + '/host/library' },
                  { label: 'Favorites', href: '/room/' + roomId + '/host/favorites' },
                  { label: 'Recent', href: '/room/' + roomId + '/host/recent' },
                ].map((link) => {
                  const isActive = location.pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      to={link.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={[
                        'flex min-h-9 shrink-0 items-center rounded-media px-3 text-[0.6875rem] font-semibold transition-[background-color,color,transform,scale] duration-150 active:scale-[0.98]',
                        isActive ? 'bg-surface text-signal' : 'text-ink-2 hover:bg-surface hover:text-ink',
                      ].join(' ')}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </nav>
          </header>

          <main className="mx-auto w-full max-w-[1240px] px-4 pb-36 pt-6 sm:px-6 lg:px-8 lg:pt-8">
            <div key={location.pathname} className="page-enter">
              <Outlet context={context} />
            </div>
          </main>

          <PlayerDock
            roomId={roomId}
            nowPlaying={nowPlaying}
            playback={data.playback}
            onTogglePlay={togglePlay}
            onNext={next}
          />
        </div>
      </div>
      {toastNode}
    </HostPlayer>
  );
}
