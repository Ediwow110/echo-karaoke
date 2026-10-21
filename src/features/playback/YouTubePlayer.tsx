import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowsOutIcon, CornersInIcon, CornersOutIcon, PlayIcon } from '@phosphor-icons/react';
import type { PlaybackState } from './playbackApi';
import { Button, IconButton } from '../../ui';

export type PlayerHandle = {
  load(videoId: string): void;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
};

export type PlayerFactory = (element: HTMLElement, onEnded: () => void) => PlayerHandle;

export type PlayerViewMode = 'normal' | 'theater';

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
  const [needsTap, setNeedsTap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (hostRef.current === null || playerFactory === undefined) {
      return;
    }
    playerRef.current = playerFactory(hostRef.current, onEnded);
    setReady(true);
    return () => {
      playerRef.current = null;
    };
  }, [playerFactory, onEnded]);

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

        <div className="absolute right-3 top-3 flex items-center gap-2" role="group" aria-label="Player view">
          <IconButton icon={<CornersOutIcon size={18} weight="regular" />} label="Theater" active={mode === 'theater'} onClick={() => onModeChange?.('theater')} />
          <IconButton icon={<CornersInIcon size={18} weight="regular" />} label="Normal" active={mode === 'normal'} onClick={() => onModeChange?.('normal')} />
          <IconButton icon={<ArrowsOutIcon size={18} weight="regular" />} label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} active={isFullscreen} onClick={() => void toggleFullscreen()} />
        </div>

        {overlay}
      </div>

      {needsTap ? (
        <Button
          variant="primary"
          size="md"
          className="mt-3"
          icon={<PlayIcon size={18} weight="fill" />}
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
      ) : null}

      {error !== null ? (
        <p role="alert" className="mt-3 rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{error}</p>
      ) : null}
    </section>
  );
}