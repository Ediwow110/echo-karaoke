import { createContext, useContext } from 'react';

type PlayerError = {
  code: number;
  videoId: string;
  title: string;
};

export type HostPlayerValue = {
  needsTap: boolean;
  playerError: PlayerError | null;
  advanceStalled: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  fullscreen: boolean;
  stageActive: boolean;
  registerStageSlot: (element: HTMLElement | null) => void;
  requestPlay: () => void;
  seekBy: (seconds: number) => void;
  seekTo: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleFullscreen: () => void;
  skipFailed: () => void;
  retryAdvance: () => void;
  findAlternative: () => void;
};

export const HostPlayerContext = createContext<HostPlayerValue | null>(null);

/**
 * The player state that the host pages share.
 * It lives apart from the player component on purpose. A module that holds
 * both a component and a hook cannot be hot reloaded, and the browser then
 * loses its place when the file is edited.
 */
export function useHostPlayer(): HostPlayerValue {
  const value = useContext(HostPlayerContext);
  if (value === null) {
    throw new Error('useHostPlayer must be used inside a host room screen');
  }
  return value;
}
