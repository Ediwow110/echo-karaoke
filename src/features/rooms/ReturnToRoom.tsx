import { Link } from 'react-router-dom';
import type { RoomSession } from './sessionStore';

/**
 * A way back to the room this browser hosted. The caller decides whether that
 * room is still alive, because the same answer also fills the navigation.
 */
export default function ReturnToRoom({ room, className }: { room: RoomSession | null; className?: string }) {
  if (room === null) {
    return null;
  }

  return (
    <p className={['text-[0.75rem] leading-[1.6] text-ink-2', className].filter(Boolean).join(' ')}>
      Still hosting <span className="font-semibold text-ink">{room.roomName}</span>?{' '}
      <Link
        to={'/room/' + room.roomId + '/host'}
        className="inline-flex min-h-11 items-center font-semibold text-signal hover:underline"
      >
        Back to the room
      </Link>
    </p>
  );
}
