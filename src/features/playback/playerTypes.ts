export type PlayerHandle = {
  load(videoId: string, startSeconds?: number): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  setVolume(volume: number): void;
  getVolume(): number;
  getState(): number;
  destroy(): void;
};

export type PlayerCallbacks = {
  onEnded: () => void;
  onError?: (code: number) => void;
  onReady?: () => void;
  onStateChange?: (state: number) => void;
};

export type PlayerFactory = (element: HTMLElement, callbacks: PlayerCallbacks) => PlayerHandle;
