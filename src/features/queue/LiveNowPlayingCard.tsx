import type { ReactNode } from 'react';
import type { QueueEntry } from '../rooms/useRoomData';
import type { PlaybackState } from '../playback/playbackApi';
import { useHostPlayer } from '../playback/useHostPlayer';
import NowPlayingCard from './NowPlayingCard';

type Props = {
  song: QueueEntry | null;
  playback: PlaybackState | undefined;
  variant?: 'host' | 'side';
  showHeader?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  className?: string;
};

// Isolates the per-second player clock so the search fields around it do not
// re-render while the host is typing.
export default function LiveNowPlayingCard({ song, playback, ...rest }: Props) {
  const player = useHostPlayer();
  return (
    <NowPlayingCard
      song={song}
      playback={playback}
      currentTime={song === null ? undefined : player.currentTime}
      duration={song === null ? undefined : player.duration}
      {...rest}
    />
  );
}
