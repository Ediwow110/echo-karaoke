import { useEffect, useRef, useState } from 'react';
import type { PlaybackState } from './playbackApi';

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
};

export default function YouTubePlayer({ playback, onEnded, onProgress, playerFactory, mode = 'normal', onModeChange }: Props) {
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
    <section ref={panelRef} className={'player-panel' + (mode === 'theater' ? ' player-theater' : '')} aria-label="Karaoke player">
      <div className="player-stage" data-mode={mode}>
        {videoId === null ? (
          <p className="empty-state">Add a song to start the night.</p>
        ) : (
          <div className="player-host" ref={hostRef} data-video-id={videoId} />
        )}
      </div>

      <div className="player-modes" role="group" aria-label="Player view">
        <button
          className="mode-button"
          type="button"
          aria-pressed={mode === 'normal'}
          onClick={() => onModeChange?.('normal')}
        >
          Normal
        </button>
        <button
          className="mode-button"
          type="button"
          aria-pressed={mode === 'theater'}
          onClick={() => onModeChange?.('theater')}
        >
          Theater
        </button>
        <button
          className="mode-button"
          type="button"
          aria-pressed={isFullscreen}
          onClick={() => void toggleFullscreen()}
        >
          {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>

      {needsTap ? (
        <button
          className="action-button action-primary"
          type="button"
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
        </button>
      ) : null}

      {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
      {videoId !== null && playback?.currentVideoId !== undefined ? (
        <p className="quiet-note">Now playing {videoId}</p>
      ) : null}
    </section>
  );
}