import type { PlayerFactory, PlayerHandle } from './playerTypes';

type YouTubePlayerLike = {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  getVolume(): number;
  destroy(): void;
};

type YouTubeApi = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayerLike;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
};

const API_TIMEOUT_MS = 8000;
let apiPromise: Promise<YouTubeApi> | null = null;

function finitePosition(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function loadApi(): Promise<YouTubeApi> {
  if (apiPromise !== null) {
    return apiPromise;
  }

  apiPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (api: YouTubeApi): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(api);
    };
    const fail = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error('The YouTube player could not be loaded'));
    };

    const timeout = window.setTimeout(fail, API_TIMEOUT_MS);
    const existing = (window as unknown as { YT?: YouTubeApi }).YT;
    if (existing !== undefined) {
      finish(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);

    (window as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = () => {
      const api = (window as unknown as { YT?: YouTubeApi }).YT;
      if (api === undefined) {
        fail();
        return;
      }
      finish(api);
    };
  });

  apiPromise.catch(() => {
    apiPromise = null;
  });

  return apiPromise;
}

export const youtubePlayerFactory: PlayerFactory = (element, callbacks) => {
  let player: YouTubePlayerLike | null = null;
  let ready = false;
  let state = -1;
  let pending: { videoId: string; startSeconds: number } | null = null;
  let wantsPlay = false;
  let volume = 100;
  let starting = false;
  let destroyed = false;
  // The API replaces whatever element it is given. Handing it the caller's node
  // detaches a node React still owns, and the next route change dies with
  // NotFoundError: insertBefore. So the factory owns this throwaway child instead.
  let mount: HTMLElement | null = null;

  // A blocked or failed script must remain retryable. A single failed load
  // used to leave the host clicking an overlay that could never work.
  const startPlayer = (): void => {
    if (starting || player !== null || destroyed) {
      return;
    }
    starting = true;
    void loadApi()
      .then((api) => {
        if (destroyed) return;
        if (mount === null) {
          mount = document.createElement('div');
          mount.style.width = '100%';
          mount.style.height = '100%';
        }
        if (mount.parentNode === null) {
          element.appendChild(mount);
        }
        player = new api.Player(mount, {
          height: '100%',
          width: '100%',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              ready = true;
              player?.setVolume(volume);
              if (pending !== null) {
                player?.loadVideoById(pending);
                pending = null;
              }
              if (wantsPlay) {
                player?.playVideo();
              }
              callbacks.onReady?.();
            },
            onStateChange: (event: { data: number }) => {
              state = event.data;
              callbacks.onStateChange?.(event.data);
              if (player !== null && event.data === api.PlayerState.ENDED) {
                callbacks.onEnded();
              }
            },
            onError: (event: { data: number }) => {
              callbacks.onError?.(event.data);
            },
          },
        });
      })
      .catch(() => {
        if (destroyed) return;
        player = null;
        callbacks.onError?.(-1);
      })
      .finally(() => {
        starting = false;
      });
  };

  // The YouTube player hands over its controls a moment after it is built, so
  // a song that arrives early waits instead of being dropped.
  const handle: PlayerHandle = {
    load(videoId: string, startSeconds = 0) {
      if (!ready) {
        pending = { videoId, startSeconds };
        startPlayer();
        return;
      }
      player?.loadVideoById({ videoId, startSeconds });
    },
    play() {
      wantsPlay = true;
      if (!ready) return;
      player?.playVideo();
    },
    pause() {
      wantsPlay = false;
      if (!ready) return;
      player?.pauseVideo();
    },
    seekTo(seconds: number) {
      if (!ready || player === null || !Number.isFinite(seconds)) return;
      player.seekTo(Math.max(0, seconds), true);
    },
    getCurrentTime() {
      if (!ready || player === null) return 0;
      return finitePosition(player.getCurrentTime());
    },
    getDuration() {
      if (!ready || player === null) return 0;
      return finiteDuration(player.getDuration());
    },
    setVolume(next: number) {
      if (!Number.isFinite(next)) return;
      volume = Math.min(100, Math.max(0, Math.round(next)));
      if (!ready || player === null) return;
      player.setVolume(volume);
    },
    getVolume() {
      return volume;
    },
    getState() {
      if (!ready || player === null || typeof player.getPlayerState !== 'function') {
        return state;
      }
      return player.getPlayerState();
    },
    destroy() {
      destroyed = true;
      try {
        player?.destroy();
      } catch {
        // A player that never finished loading has nothing to release.
      }
      player = null;
      ready = false;
      pending = null;
      wantsPlay = false;
      // destroy() drops the iframe the API swapped in; the mount we appended
      // stays behind and would accumulate across retries if it were not removed.
      mount?.remove();
      mount = null;
    },
  };

  startPlayer();
  return handle;
};
