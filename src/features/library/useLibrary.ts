import { useEffect, useState } from 'react';
import {
  getFavoriteSongs,
  getLibrary,
  getRecent,
  subscribeLibrary,
  type LibrarySong,
  type RecentSong,
} from './libraryStore';

function useLibraryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeLibrary(() => setVersion((current) => current + 1)), []);
  return version;
}

export function useLibrarySongs(): LibrarySong[] {
  useLibraryVersion();
  return getLibrary();
}

export function useFavoriteSongs(): LibrarySong[] {
  useLibraryVersion();
  return getFavoriteSongs();
}

export function useRecentSongs(): RecentSong[] {
  useLibraryVersion();
  return getRecent();
}
