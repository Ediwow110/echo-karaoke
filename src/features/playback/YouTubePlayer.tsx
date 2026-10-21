import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowsOutIcon, CornersInIcon, CornersOutIcon, PlayIcon } from '@phosphor-icons/react';
import type { PlaybackState } from './playbackApi';
import { Button, IconButton } from '../../ui';

export type PlayerHandle = {
  load(videoId: string): void;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
  getState(): number;
  destroy(): void;
};

export type PlayerFactory = (element: HTMLElement, onEnded: () => void) => PlayerHandle;

export type PlayerViewMode = 'normal' | 'theater';

const PLAYER_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

type Props = {
  playback: PlaybackState | undefined;
  onEnded: () => void;
  onProgress?: (seconds: number) => void;
  playerFactory?: PlayerFactory;
  mode?: PlayerViewMode;
  onModeChange?: (mode: PlayerViewMode) => void;
  overlay?: ReactNode;
};

export default function YouTubePlayer({ playback, onEnded, onProgress, playerFactory, mode = 'normal', onModeChange, overlay }: Props) {
  const panelRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const destroyTimerRef = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const [needsTap, setNeedsTap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (hostRef.current === null || playerFactory === undefined) {
      return;
    }
    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    }
    // The page repolls every few seconds and hands over a new callback each
    // time. The player must survive that, so the callback is read through a
    // reference and the player is built once.
    if (playerRef.current === null) {
      playerRef.current = playerFactory(hostRef.current, () => onEndedRef.current());
    }
    setReady(true);
    return () => {
      // A remount in the development build tears the effect down and sets it
      // up again straight away. The player is left alone for a tick so the
      // next setup can keep it, because a player that is destroyed and built
      // again on the same frame leaves the frame without controls.
      destroyTimerRef.current = window.setTimeout(() => {
        destroyTimerRef.current = null;
        playerRef.current?.destroy();
        playerRef.current = null;
      }, 0);
    };
  }, [playerFactory]);

  const videoId = playback?.currentVideoId ?? null;
  const isPlaying = playback?.isPlaying === true;

  useEffect(() => {
    const player = playerRef.current;
    if (!ready || player === null || videoId === null) {
      return;
    }
    try {
      player.load(videoId);
      if (isPlaying) {
        player.play();
      }
    } catch {
      setError('This video cannot be played here. Skipping may help.');
    }
  }, [ready, videoId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!ready || player === null) {
      return;
    }
    try {
      if (isPlaying) player.play();
      else player.pause();
    } catch {
      setNeedsTap(true);
    }
  }, [ready, isPlaying]);

  useEffect(() => {
    if (onProgress === undefined) {
      return;
    }
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (player === null) return;
      try {
        onProgress(player.getCurrentTime());
      } catch {
        // Ignore a player that is not ready yet.
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [onProgress]);

  useEffect(() => {
    function syncFullscreen(): void {
      setIsFullscreen(document.fullscreenElement !== null && document.fullscreenElement !== undefined);
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      setNeedsTap(false);
      return;
    }
    const player = playerRef.current;
    if (!ready || player === null) {
      return;
    }

    // A browser holds back a video with sound until the host touches the
    // screen. The room says playing while the picture sits still, so the
    // player state is watched and the host is asked to tap.
    let waited = 0;
    const timer = window.setInterval(() => {
      waited += 500;
      const state = player.getState();
      if (state === PLAYER_STATE.playing || state === PLAYER_STATE.buffering) {
        setNeedsTap(false);
        return;
      }
      if (state === PLAYER_STATE.unstarted) {
        // The player is still handing over its controls.
        return;
      }
      if (waited >= 1200) {
        setNeedsTap(true);
      }
    }, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [ready, isPlaying, videoId]);

  async function toggleFullscreen(): Promise<void> {
    // Fullscreen the whole panel so the view controls stay reachable on screen.
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    try {
      if (document.fullscreenElement !== null && document.fullscreenElement !== undefined) {
        await document.exitFullscreen();
      } else {
        await panel.requestFullscreen();
      }
    } catch {
      // Browsers refuse fullscreen without a user gesture or in embedded frames.
    }
  }

  return (
    <section ref={panelRef} className={'rounded-panel border border-line bg-surface p-4' + (mode === 'theater' ? ' lg:col-span-2' : '')} aria-label="Karaoke player">
      <div className="relative aspect-video overflow-hidden rounded-media bg-black" data-mode={mode}>
        {videoId === null ? (
          <p className="grid h-full place-items-center text-[0.9375rem] text-ink-3">Add a song to start the night.</p>
        ) : (
          <div className="h-full w-full" ref={hostRef} data-video-id={videoId} />
        )}

        {needsTap ? (
          <div className="absolute inset-0 grid place-items-center bg-graphite/70">
            <Button
              variant="primary"
              size="lg"
              icon={<PlayIcon size={20} weight="fill" />}
              onClick={() => {
                try {
                  playerRef.current?.play();
                  setNeedsTap(false);
                } catch {
                  setNeedsTap(true);
                }
              }}
            >
              Tap to start audio
            </Button>
          </div>
        ) : null}

        <div className="absolute right-3 top-3 flex items-center gap-2" role="group" aria-label="Player view">
          <IconButton icon={<CornersOutIcon size={18} weight="regular" />} label="Theater" toggle active={mode === 'theater'} onClick={() => onModeChange?.('theater')} />
          <IconButton icon={<CornersInIcon size={18} weight="regular" />} label="Normal" toggle active={mode === 'normal'} onClick={() => onModeChange?.('normal')} />
          <IconButton icon={<ArrowsOutIcon size={18} weight="regular" />} label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} toggle active={isFullscreen} onClick={() => void toggleFullscreen()} />
        </div>

        {overlay}
      </div>

      {error !== null ? (
        <p role="alert" className="mt-3 rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{error}</p>
      ) : null}
    </section>
  );
}