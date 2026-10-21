import { createContext, useContext, type ReactNode } from 'react';
import type { EdgeApi } from '../lib/edgeApi';

const RoomApiContext = createContext<EdgeApi | null>(null);

export function RoomApiProvider({ api, children }: { api: EdgeApi; children: ReactNode }) {
  return <RoomApiContext.Provider value={api}>{children}</RoomApiContext.Provider>;
}

export function useRoomApi(): EdgeApi {
  const api = useContext(RoomApiContext);
  if (api === null) {
    throw new Error('RoomApiProvider is missing above this screen');
  }
  return api;
}
