import type { PlayerFactory, PlayerHandle } from './YouTubePlayer';

type YouTubePlayerLike = {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
};

type YouTubeApi = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayerLike;
  PlayerState: { ENDED: number };
};

let apiPromise: Promise<YouTubeApi> | null = null;

function loadApi(): Promise<YouTubeApi> {
  if (apiPromise !== null) {
    return apiPromise;
  }

  apiPromise = new Promise((resolve, reject) => {
    const existing = (window as unknown as { YT?: YouTubeApi }).YT;
    if (existing !== undefined) {
      resolve(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('The YouTube player could not be loaded'));
    document.head.appendChild(script);

    (window as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = () => {
      const api = (window as unknown as { YT?: YouTubeApi }).YT;
      if (api === undefined) {
        reject(new Error('The YouTube player could not be loaded'));
        return;
      }
      resolve(api);
    };
  });

  return apiPromise;
}

export const youtubePlayerFactory: PlayerFactory = (element, onEnded) => {
  let player: YouTubePlayerLike | null = null;
  let ready = false;
  let state = -1;
  let pendingVideoId: string | null = null;
  let wantsPlay = false;

  // The YouTube player hands over its controls a moment after it is built, so
  // a song that arrives early waits in the queue instead of being dropped.
  const handle: PlayerHandle = {
    load(videoId: string) {
      if (!ready) {
        pendingVideoId = videoId;
        return;
      }
      player?.loadVideoById(videoId);
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
    getCurrentTime() {
      if (!ready || player === null) return 0;
      return player.getCurrentTime();
    },
    getState() {
      if (!ready || player === null || typeof player.getPlayerState !== 'function') {
        return state;
      }
      return player.getPlayerState();
    },
    destroy() {
      player?.destroy();
      player = null;
      ready = false;
    },
  };

  void loadApi()
    .then((api) => {
      player = new api.Player(element, {
        height: '100%',
        width: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            ready = true;
            if (pendingVideoId !== null) {
              player?.loadVideoById(pendingVideoId);
              pendingVideoId = null;
            }
            if (wantsPlay) {
              player?.playVideo();
            }
          },
          onStateChange: (event: { data: number }) => {
            state = event.data;
            if (player !== null && event.data === api.PlayerState.ENDED) {
              onEnded();
            }
          },
        },
      });
    })
    .catch(() => {
      player = null;
    });

  return handle;
};
