import { useEffect, useState } from 'react';
import type { EdgeApi } from '../../lib/edgeApi';
import { readRoomAsHost } from './roomApi';
import { getHostedRoom, type RoomSession } from './sessionStore';

type RoomRead = { status?: string };

// A host sitting on the create screen is not a ticking clock, but the room they
// left behind can end while they are here.
const CHECK_INTERVAL_MS = 60_000;

/**
 * The room this browser is still hosting, decided by the server.
 *
 * The host screen owns the only player, so a host who steps out to create
 * another room keeps commanding this one and needs it in the navigation. A
 * stored session is only a candidate: the abandoned-room sweep deletes a room
 * once every member has stopped heartbeating, so a local timestamp would
 * either offer a dead room or hide a live one.
 */
export function useHostedRoom(api: EdgeApi): RoomSession | null {
  const [room, setRoom] = useState<RoomSession | null>(null);

  useEffect(() => {
    let active = true;
    let timer = 0;

    const check = (): void => {
      const candidate = getHostedRoom();
      if (candidate === null) {
        setRoom(null);
        return;
      }
      void readRoomAsHost<RoomRead>(api, candidate.roomId)
        .then((read) => {
          if (!active) return;
          setRoom(read.status === 'live' ? candidate : null);
        })
        .catch(() => {
          // A failed read is not an answer. Blanking the offer on a blip took
          // away the only way back to a room this browser still holds a pass
          // for, so keep the last known room and ask again on the next check.
        });
    };

    check();
    // A host can sit on this screen for a while: the room can end, and it must
    // stop being offered when it does.
    timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = (): void => {
      if (!document.hidden) check();
    };
    const onOnline = (): void => check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [api]);

  return room;
}
