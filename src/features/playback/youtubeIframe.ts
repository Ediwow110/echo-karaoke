import type { PlayerFactory, PlayerHandle } from './YouTubePlayer';

type YouTubePlayerLike = {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
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

  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
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

  const handle: PlayerHandle = {
    load(videoId: string) {
      if (player === null) return;
      player.loadVideoById(videoId);
    },
    play() {
      player?.playVideo();
    },
    pause() {
      player?.pauseVideo();
    },
    getCurrentTime() {
      return player?.getCurrentTime() ?? 0;
    },
  };

  void loadApi()
    .then((api) => {
      player = new api.Player(element, {
        height: '100%',
        width: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
        events: {
          onStateChange: (event: { data: number }) => {
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
