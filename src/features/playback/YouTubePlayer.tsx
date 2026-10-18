import { useEffect, useRef, useState } from 'react';
import type { PlaybackState } from './playbackApi';

export type PlayerHandle = {
  load(videoId: string): void;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
};

export type PlayerFactory = (element: HTMLElement, onEnded: () => void) => PlayerHandle;

type Props = {
  playback: PlaybackState | undefined;
  onEnded: () => void;
  onProgress?: (seconds: number) => void;
  playerFactory?: PlayerFactory;
};

export default function YouTubePlayer({ playback, onEnded, onProgress, playerFactory }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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

  return (
    <section className="player-panel" aria-label="Karaoke player">
      <div className="player-stage">
        {videoId === null ? (
          <p className="empty-state">Add a song to start the night.</p>
        ) : (
          <div className="player-host" ref={hostRef} data-video-id={videoId} />
        )}
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
