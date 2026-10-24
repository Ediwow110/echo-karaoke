import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/csr/SpinnerGap';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type { PlaybackState } from './playbackApi';
import { youtubePlayerFactory } from './youtubeIframe';
import { HostPlayerContext, type HostPlayerValue } from './useHostPlayer';
import type { PlayerHandle } from './playerTypes';
import type { QueueEntry } from '../rooms/useRoomData';
import { Button } from '../../ui';

export type { HostPlayerValue } from './useHostPlayer';

type PlayerError = {
  code: number;
  videoId: string;
  title: string;
};

type Props = {
  playback: PlaybackState | undefined;
  nowPlaying: QueueEntry | null;
  onNext: () => Promise<boolean>;
  onReport: (seconds: number, duration: number, songId: string | null) => void;
  onFindAlternative: (query: string) => void;
  children: ReactNode;
};

const VOLUME_KEY = 'karaoke.volume';
const PLAYER_STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 85;
  } catch {
    return 85;
  }
}

function saveVolume(volume: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // The slider still works for this session.
  }
}

export default function HostPlayer({
  playback,
  nowPlaying,
  onNext,
  onReport,
  onFindAlternative,
  children,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const destroyTimerRef = useRef<number | null>(null);
  const loadedVideoRef = useRef<string | null>(null);
  const autoSkippedRef = useRef<string | null>(null);
  const advancingRef = useRef(false);
  const onNextRef = useRef(onNext);
  const onReportRef = useRef(onReport);
  const playbackRef = useRef(playback);
  const nowPlayingRef = useRef(nowPlaying);
  const slotCleanupRef = useRef<(() => void) | null>(null);
  const volumeRef = useRef(readVolume());
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [factoryReady, setFactoryReady] = useState(false);
  const [playerState, setPlayerState] = useState<number>(PLAYER_STATE.unstarted);
  const [needsTap, setNeedsTap] = useState(false);
  const [playerError, setPlayerError] = useState<PlayerError | null>(null);
  const [advanceStalled, setAdvanceStalled] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(volumeRef.current);
  const [fullscreen, setFullscreen] = useState(false);
  const [isLg, setIsLg] = useState(typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = () => setIsLg(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  onNextRef.current = onNext;
  onReportRef.current = onReport;
  playbackRef.current = playback;
  nowPlayingRef.current = nowPlaying;

  const videoId = playback?.currentVideoId ?? null;
  const currentSongId = playback?.currentSongId ?? null;
  const isPlaying = playback?.isPlaying === true;

  const handlePlayerError = useCallback((code: number) => {
    const current = playbackRef.current;
    const id = current?.currentVideoId ?? null;
    if (id === null) {
      return;
    }
    setNeedsTap(false);
    setAdvanceStalled(false);
    setPlayerError({
      code,
      videoId: id,
      title: nowPlayingRef.current?.title ?? 'This video',
    });
  }, []);

  const advance = useCallback(async (): Promise<boolean> => {
    let advanced = false;
    try {
      advanced = await onNextRef.current();
    } catch {
      advanced = false;
    }
    setAdvanceStalled(!advanced);
    return advanced;
  }, []);

  const handleEnded = useCallback(() => {
    if (advancingRef.current) {
      return;
    }
    advancingRef.current = true;
    window.setTimeout(() => {
      advancingRef.current = false;
    }, 1500);
    void advance();
  }, [advance]);

  useEffect(() => {
    if (hostRef.current === null) {
      return;
    }
    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    }
    if (playerRef.current === null) {
      playerRef.current = youtubePlayerFactory(hostRef.current, {
        onEnded: handleEnded,
        onError: handlePlayerError,
        onReady: () => {
          playerRef.current?.setVolume(volumeRef.current);
        },
        onStateChange: (state) => setPlayerState(state),
      });
    }
    setFactoryReady(true);
    return () => {
      // A development remount tears the effect down and sets it up again on the
      // same frame. Give the next setup a tick to keep the same player box.
      destroyTimerRef.current = window.setTimeout(() => {
        destroyTimerRef.current = null;
        playerRef.current?.destroy();
        playerRef.current = null;
      }, 0);
    };
  }, [handleEnded, handlePlayerError]);

  useEffect(() => {
    const player = playerRef.current;
    if (!factoryReady || player === null) {
      return;
    }
    if (videoId === null) {
      loadedVideoRef.current = null;
      setPlayerError(null);
      setNeedsTap(false);
      setAdvanceStalled(false);
      setCurrentTime(0);
      setDuration(0);
      try {
        player.pause();
      } catch {
        // The player may not have finished its handoff yet.
      }
      return;
    }
    if (loadedVideoRef.current !== videoId) {
      loadedVideoRef.current = videoId;
      autoSkippedRef.current = null;
      setPlayerError(null);
      setNeedsTap(false);
      setAdvanceStalled(false);
      setCurrentTime(playback?.positionSeconds ?? 0);
      setDuration(nowPlaying?.durationSeconds ?? 0);
      player.load(videoId, Math.max(0, playback?.positionSeconds ?? 0));
    }
  }, [factoryReady, nowPlaying?.durationSeconds, playback?.positionSeconds, videoId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!factoryReady || player === null || videoId === null) {
      return;
    }
    try {
      if (isPlaying) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      if (isPlaying) {
        setNeedsTap(true);
      }
    }
  }, [factoryReady, isPlaying, videoId]);

  useEffect(() => {
    if (!isPlaying || videoId === null) {
      setNeedsTap(false);
      return;
    }
    let waited = 0;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player === null) {
        return;
      }
      waited += 500;
      const state = player.getState();
      if (state === PLAYER_STATE.playing || state === PLAYER_STATE.buffering) {
        setNeedsTap(false);
        window.clearInterval(timer);
        return;
      }
      if (waited >= 2000) {
        setNeedsTap(true);
        window.clearInterval(timer);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, videoId]);

  const wasPlaying = useRef(false);
  useEffect(() => {
    const previous = wasPlaying.current;
    wasPlaying.current = isPlaying;
    if (previous && !isPlaying && videoId !== null) {
      const player = playerRef.current;
      if (player !== null) {
        onReportRef.current(Math.floor(player.getCurrentTime()), Math.floor(player.getDuration()), currentSongId);
      }
    }
  }, [currentSongId, isPlaying, videoId]);

  useEffect(() => {
    if (!isPlaying || videoId === null) {
      return;
    }
    // Send the duration as soon as the player knows it so every phone can
    // draw an honest progress bar without waiting for the first long poll.
    const early = window.setTimeout(() => {
      const player = playerRef.current;
      if (player === null) return;
      const total = player.getDuration();
      if (Number.isFinite(total) && total > 0) {
        onReportRef.current(Math.floor(player.getCurrentTime()), Math.floor(total), currentSongId);
      }
    }, 2600);
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player === null) {
        return;
      }
      try {
        onReportRef.current(Math.floor(player.getCurrentTime()), Math.floor(player.getDuration()), currentSongId);
      } catch {
        // A player that is still loading reports on the next tick.
      }
    }, 12000);
    return () => {
      window.clearTimeout(early);
      window.clearInterval(timer);
    };
  }, [currentSongId, isPlaying, videoId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player === null) {
        return;
      }
      try {
        const next = player.getCurrentTime();
        setCurrentTime((current) => (Math.abs(current - next) < 0.35 ? current : next));
        const total = player.getDuration();
        if (Number.isFinite(total) && total > 0) {
          setDuration((current) => (Math.abs(current - total) < 0.5 ? current : total));
        }
      } catch {
        // Ignore a player that has not handed over timing yet.
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (duration > 0 || nowPlaying?.durationSeconds == null) {
      return;
    }
    setDuration(nowPlaying.durationSeconds);
  }, [duration, nowPlaying?.durationSeconds]);

  useEffect(() => {
    if (playerError === null) {
      return;
    }
    if (autoSkippedRef.current === playerError.videoId) {
      return;
    }
    const timer = window.setTimeout(() => {
      autoSkippedRef.current = playerError.videoId;
      void advance();
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [advance, playerError]);

  useEffect(() => {
    const sync = (): void => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement !== undefined);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const registerStageSlot = useCallback((element: HTMLElement | null) => {
    slotCleanupRef.current?.();
    slotCleanupRef.current = null;
    setSlot(element);
    if (element === null) {
      setRect({ top: 0, left: 0, width: 0, height: 0 });
      return;
    }
    const measure = (): void => {
      const box = element.getBoundingClientRect();
      const next = { top: box.top, left: box.left, width: box.width, height: box.height };
      setRect((current) => (
        current.top === next.top
        && current.left === next.left
        && current.width === next.width
        && current.height === next.height
          ? current
          : next
      ));
    };
    let frame = 0;
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    slotCleanupRef.current = () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      slotCleanupRef.current?.();
      slotCleanupRef.current = null;
    };
  }, []);

  const requestPlay = useCallback(() => {
    setNeedsTap(false);
    try {
      playerRef.current?.play();
    } catch {
      setNeedsTap(true);
      return;
    }
    // A click is the one gesture that can release autoplay. Check once more
    // in case the browser still refused, so the overlay does not vanish
    // while the picture remains stopped.
    window.setTimeout(() => {
      const player = playerRef.current;
      if (player === null) {
        return;
      }
      const state = player.getState();
      if (state !== PLAYER_STATE.playing && state !== PLAYER_STATE.buffering) {
        setNeedsTap(true);
      }
    }, 1600);
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (player === null) {
      return;
    }
    const target = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    player.seekTo(target);
    setCurrentTime(target);
    onReportRef.current(
      Math.floor(target),
      Math.floor(player.getDuration()),
      playbackRef.current?.currentSongId ?? null,
    );
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (player === null) {
      return;
    }
    const current = player.getCurrentTime();
    const step = Number.isFinite(seconds) ? seconds : 0;
    const target = Math.max(0, (Number.isFinite(current) ? current : 0) + step);
    seekTo(target);
  }, [seekTo]);

  const changeVolume = useCallback((next: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(next)));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    playerRef.current?.setVolume(clamped);
    saveVolume(clamped);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const layer = layerRef.current;
    if (layer === null) {
      return;
    }
    if (document.fullscreenElement !== null && document.fullscreenElement !== undefined) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void layer.requestFullscreen().catch(() => undefined);
  }, []);

  const skipFailed = useCallback(() => {
    autoSkippedRef.current = playerError?.videoId ?? autoSkippedRef.current;
    setPlayerError(null);
    setNeedsTap(false);
    void advance();
  }, [advance, playerError?.videoId]);

  const retryAdvance = useCallback(() => {
    setAdvanceStalled(false);
    void advance();
  }, [advance]);

  const findAlternative = useCallback(() => {
    if (playerError === null) {
      return;
    }
    const query = playerError.title + ' karaoke';
    onFindAlternative(query);
  }, [onFindAlternative, playerError]);

  const effectiveDuration = duration > 0 ? duration : nowPlaying?.durationSeconds ?? 0;
  const loading = videoId !== null
    && needsTap === false
    && playerState !== PLAYER_STATE.playing
    && playerState !== PLAYER_STATE.buffering
    && playerState !== PLAYER_STATE.ended
    && isPlaying
    && playerError === null
    && !advanceStalled;

  const value = useMemo<HostPlayerValue>(() => ({
    needsTap,
    playerError,
    advanceStalled,
    loading,
    currentTime,
    duration: effectiveDuration,
    volume,
    fullscreen,
    stageActive: slot !== null,
    registerStageSlot,
    requestPlay,
    seekBy,
    seekTo,
    setVolume: changeVolume,
    toggleFullscreen,
    skipFailed,
    retryAdvance,
    findAlternative,
  }), [
    advanceStalled,
    changeVolume,
    currentTime,
    effectiveDuration,
    findAlternative,
    fullscreen,
    loading,
    needsTap,
    playerError,
    registerStageSlot,
    requestPlay,
    retryAdvance,
    seekBy,
    seekTo,
    skipFailed,
    slot,
    toggleFullscreen,
    volume,
  ]);

  const isFloatingFrame = slot === null && videoId !== null && isLg;
  const layerStyle = isFloatingFrame
    // Keep the frame clear of the host header. The dock already carries the
    // transport controls; this is only the picture.
    ? { bottom: 124, right: 16, width: 280, height: 158, opacity: 1, pointerEvents: 'auto' as const }
    : slot === null
      ? { top: 0, left: -10000, width: 320, height: 180, opacity: 0, pointerEvents: 'none' as const }
      : { top: rect.top, left: rect.left, width: rect.width, height: rect.height, opacity: 1, pointerEvents: 'auto' as const };

  return (
    <HostPlayerContext.Provider value={value}>
      {children}
      {slot === null && playerError !== null ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[7.25rem] z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-[32rem] items-center gap-2 rounded-panel border border-danger/30 bg-danger-soft/95 px-3.5 py-2.5 text-[0.75rem] text-danger shadow-[0_12px_36px_rgba(0,0,0,0.4)] backdrop-blur">
            <WarningCircleIcon size={16} className="shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 leading-[1.5]">This video can't play here. Skipping to the next song.</p>
            <button type="button" onClick={skipFailed} className="shrink-0 font-semibold underline underline-offset-2">Skip now</button>
            <button type="button" onClick={findAlternative} className="hidden shrink-0 text-ink-2 underline underline-offset-2 hover:text-ink sm:block">Alternative</button>
          </div>
        </div>
      ) : null}
      {slot === null && playerError === null && advanceStalled ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[7.25rem] z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-[32rem] items-center gap-2 rounded-panel border border-gold/30 bg-graphite-deep/95 px-3.5 py-2.5 text-[0.75rem] text-gold shadow-[0_12px_36px_rgba(0,0,0,0.4)] backdrop-blur">
            <WarningCircleIcon size={16} className="shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 leading-[1.5]">Playback stalled. The next song did not start.</p>
            <button type="button" onClick={retryAdvance} className="shrink-0 font-semibold underline underline-offset-2">Retry</button>
          </div>
        </div>
      ) : null}
      <div
        ref={layerRef}
        data-host-player
        data-stage-visible={slot === null ? 'false' : 'true'}
        aria-hidden={slot === null && !isFloatingFrame ? 'true' : undefined}
        inert={slot === null && !isFloatingFrame}
        style={layerStyle}
        className="fixed z-20 overflow-hidden rounded-media bg-graphite-deep"
      >
        <div ref={hostRef} className="absolute inset-0" />
        {slot === null || videoId === null ? null : (
          <div className="pointer-events-none absolute inset-0">
            {loading && needsTap === false && playerError === null ? (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-graphite-deep/70 p-3 text-signal">
                <SpinnerGapIcon size={22} className="animate-spin" aria-label="Loading video" />
              </div>
            ) : null}

            {advanceStalled && playerError === null && needsTap === false ? (
              <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-graphite-deep/78 px-6 text-center">
                <div className="max-w-[26rem]">
                  <WarningCircleIcon size={26} className="mx-auto text-gold" aria-hidden="true" />
                  <p className="eyebrow mt-3 text-gold">Playback stalled</p>
                  <h3 className="mt-2 font-display text-[1.65rem] font-bold tracking-[-0.02em]">The next song didn't start.</h3>
                  <p className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
                    The room is still here. Retry the advance, or open the queue from the host screen.
                  </p>
                  <Button variant="primary" size="md" className="mt-4" onClick={retryAdvance}>
                    Retry next song
                  </Button>
                </div>
              </div>
            ) : null}

            {needsTap ? (
              <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-graphite-deep/72 px-6 text-center">
                <div className="max-w-[24rem]">
                  <p className="eyebrow text-gold">Browser autoplay restriction</p>
                  <h3 className="mt-2 font-display text-[1.65rem] font-bold tracking-[-0.02em]">Playback needs a host click.</h3>
                  <p className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
                    Your browser blocked the sound. Start the ready video once here; phone commands cannot bypass it.
                  </p>
                  <Button variant="primary" size="md" className="mt-4" icon={<PlayIcon size={16} weight="fill" />} onClick={requestPlay}>
                    Start playback
                  </Button>
                </div>
              </div>
            ) : null}

            {playerError !== null ? (
              <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-graphite-deep/82 px-6 text-center">
                <div className="max-w-[26rem]">
                  <WarningCircleIcon size={26} className="mx-auto text-gold" aria-hidden="true" />
                  <h3 className="mt-3 font-display text-[1.65rem] font-bold tracking-[-0.02em]">This video can't play here.</h3>
                  <p className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
                    The uploader restricted embedding, or the video is no longer available. The room moves on to the next available song.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button variant="primary" size="md" onClick={skipFailed}>Skip this video</Button>
                    <Button variant="secondary" size="md" onClick={findAlternative}>Find another version</Button>
                  </div>
                  <p className="mt-3 text-[0.6875rem] text-ink-3">Automatically advancing in a few seconds.</p>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </HostPlayerContext.Provider>
  );
}
