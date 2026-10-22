import { useOutletContext } from 'react-router-dom';
import type { QueueEntry, RoomView } from '../features/rooms/useRoomData';
import type { HostAction } from '../features/rooms/roomApi';
import type { ToastTone } from '../ui';

export type HostNotify = (message: string, detail?: string, tone?: ToastTone) => void;

export type HostRoomContext = {
  roomId: string;
  room: NonNullable<RoomView['room']>;
  roomName: string;
  code: string;
  hostName: string;
  joinUrl: string;
  roster: NonNullable<RoomView['roster']>;
  queue: QueueEntry[];
  nowPlaying: QueueEntry | null;
  upNext: QueueEntry[];
  playback: RoomView['playback'];
  connection: 'connecting' | 'live' | 'offline';
  notify: HostNotify;
  refresh: () => Promise<void>;
  runHost: (action: HostAction) => Promise<boolean>;
  togglePlay: () => Promise<void>;
  next: () => Promise<boolean>;
  removeSong: (songId: string) => Promise<void>;
  reorderSong: (songId: string, direction: 'up' | 'down') => Promise<void>;
  endRoom: () => Promise<void>;
};

/**
 * The room state that the host pages share.
 * It lives apart from the page component on purpose. A module that holds both
 * a component and a hook cannot be hot reloaded, and the browser then loses
 * its place when the file is edited.
 */
export function useHostRoom(): HostRoomContext {
  return useOutletContext<HostRoomContext>();
}
