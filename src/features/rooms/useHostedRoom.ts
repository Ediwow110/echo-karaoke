import { useEffect, useState } from 'react';
import type { EdgeApi } from '../../lib/edgeApi';
import { readRoomAsHost } from './roomApi';
import { getHostedRoom, type RoomSession } from './sessionStore';

type RoomRead = { status?: string };

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

  return room;
}
