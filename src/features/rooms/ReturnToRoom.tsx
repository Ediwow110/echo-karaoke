import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EdgeApi } from '../../lib/edgeApi';
import { readRoomAsHost } from './roomApi';
import { getHostedRoom, type RoomSession } from './sessionStore';

type RoomRead = { status?: string };

/**
 * A way back to the room this browser hosted.
 *
 * The host screen owns the only player, so leaving it for another room would
 * otherwise orphan the room the guests are still standing in. Whether the room
 * is still alive is the server's answer: the sweep only deletes a room once
 * every member has stopped heartbeating, so a local timestamp would either
 * offer a dead room or hide a live one.
 */
export default function ReturnToRoom({ api, className }: { api: EdgeApi; className?: string }) {
  const [room, setRoom] = useState<RoomSession | null>(null);

  useEffect(() => {
    const candidate = getHostedRoom();
    if (candidate === null) {
      return;
    }
    let active = true;
    void readRoomAsHost<RoomRead>(api, candidate.roomId)
      .then((read) => {
        if (active && read.status === 'live') {
          setRoom(candidate);
        }
      })
      .catch(() => {
        // A room that cannot be read is a room this browser cannot return to.
        if (active) {
          setRoom(null);
        }
      });
    return () => {
      active = false;
    };
  }, [api]);

  if (room === null) {
    return null;
  }

  return (
    <p className={['text-[0.75rem] leading-[1.6] text-ink-2', className].filter(Boolean).join(' ')}>
      Still hosting <span className="font-semibold text-ink">{room.roomName}</span>?{' '}
      <Link
        to={'/room/' + room.roomId + '/host'}
        className="font-semibold text-signal hover:underline"
      >
        Back to the room
      </Link>
    </p>
  );
}
