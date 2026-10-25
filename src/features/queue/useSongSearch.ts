import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomApi } from '../../app/RoomApiProvider';
import { RoomApiError } from '../../lib/edgeApi';
import type { RoomTokens } from '../../lib/edgeApi';
import { loadGuestToken, loadHostToken } from '../rooms/tokenStore';
import { addSong, type QueueSong } from './queueApi';
import { parseYouTubeVideoId } from './youtubeVideo';
import type { SearchResult } from '../../types/search';

type SearchResponse = { available: boolean; results: SearchResult[]; message?: string; source?: 'songbook' };

export type SongNotice = {
  title: string;
  position: number | null;
  videoId: string;
};

type Options = {
  roomId: string;
  initialQuery?: string;
  disabled?: boolean;
  onAdded?: (song: QueueSong) => void;
};

const DEBOUNCE_MS = 380;

export function describeAddError(error: unknown): string {
  if (error instanceof RoomApiError) {
    if (error.code === 'RATE_LIMITED') return 'That is five songs this minute. Give it a moment.';
    if (error.code === 'GUEST_CONTROLS_LOCKED') return 'The host turned off guest requests.';
    if (error.code === 'METADATA_UNAVAILABLE') return 'That video could not be read. Try another copy.';
    if (error.code === 'DUPLICATE_SONG') return 'That song is already in the queue.';
    if (error.code === 'ROOM_ENDED') return 'This room has ended.';
    if (error.code === 'NETWORK_ERROR') return 'The room service could not be reached. Try again.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'That song could not be added.';
}

export function useSongSearch({ roomId, initialQuery = '', disabled = false, onAdded }: Options) {
  const api = useRoomApi();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [available, setAvailable] = useState(true);
  const [searchBlocked, setSearchBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<SongNotice | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const addedTimers = useRef(new Map<string, number>());
  const debounceTimer = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const timer of addedTimers.current.values()) {
        window.clearTimeout(timer);
      }
      addedTimers.current.clear();
    };
  }, []);

  const search = useCallback(async (raw: string) => {
    const term = raw.trim();
    const current = requestId.current + 1;
    requestId.current = current;
    setError(null);
    setMessage(null);
    setAddError(null);
    if (term.length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      setAvailable(true);
      return;
    }

    let tokens: RoomTokens = {};
    const guestToken = loadGuestToken(roomId);
    const hostToken = loadHostToken(roomId);
    if (guestToken !== null) {
      tokens.guestToken = guestToken;
    } else if (hostToken !== null) {
      tokens.hostToken = hostToken;
    } else {
      setError('This browser has no guest pass for the room.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const response = await api.invoke<SearchResponse>(
        'youtube-search',
        { roomId, query: term },
        tokens,
      );
      if (!mounted.current || requestId.current !== current) {
        return;
      }
      const ready = response.available !== false;
      setAvailable(ready);
      setSearchBlocked(!ready);
      setResults(ready ? (response.results ?? []) : []);
      setMessage(ready ? (response.source === 'songbook' ? response.message ?? 'Recent songbook matches' : null)
        : (response.message ?? 'Search is not configured. Ask the host to enable YouTube search.'));
    } catch (caught) {
      if (!mounted.current || requestId.current !== current) {
        return;
      }
      const fallback = caught instanceof Error ? caught.message : 'The lookup failed.';
      setResults([]);
      setSearchBlocked(caught instanceof RoomApiError
        && (caught.code === 'RATE_LIMITED'
          || caught.code === 'SEARCH_UNAVAILABLE'
          || caught.code === 'LOOKUP_RATE_LIMITED'));
      setError(caught instanceof RoomApiError && caught.code === 'NETWORK_ERROR'
        ? 'YouTube search is unreachable right now. Try again.'
        : fallback);
    } finally {
      if (mounted.current && requestId.current === current) {
        setLoading(false);
      }
    }
  }, [api, roomId]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      requestId.current += 1;
      setResults([]);
      setLoading(false);
      setSearched(false);
      setAvailable(true);
      setSearchBlocked(false);
      setMessage(null);
      setError(null);
      return;
    }
    if (parseYouTubeVideoId(term) !== null) {
      requestId.current += 1;
      setLoading(false);
      setSearched(false);
      setResults([]);
      return;
    }
    requestId.current += 1;
    setLoading(true);
    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = window.setTimeout(() => {
      debounceTimer.current = null;
      void search(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current !== null) {
        window.clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [query, search]);

  const addVideo = useCallback(async (videoId: string, fallbackTitle: string) => {
    if (disabled) {
      setAddError('The host turned off guest requests.');
      return false;
    }
    setAddingId(videoId);
    setAddError(null);
    setNotice(null);
    try {
      const song = await addSong(api, roomId, videoId);
      setAddedIds((current) => current.includes(videoId) ? current : [...current, videoId]);
      setNotice({ title: song.title || fallbackTitle, position: song.position ?? null, videoId });
      const previous = addedTimers.current.get(videoId);
      if (previous !== undefined) {
        window.clearTimeout(previous);
      }
      addedTimers.current.set(videoId, window.setTimeout(() => {
        addedTimers.current.delete(videoId);
        if (mounted.current) {
          setAddedIds((current) => current.filter((addedId) => addedId !== videoId));
        }
      }, 12000));
      onAdded?.(song);
      return true;
    } catch (caught) {
      setAddError(describeAddError(caught));
      return false;
    } finally {
      if (mounted.current) {
        setAddingId(null);
      }
    }
  }, [api, disabled, onAdded, roomId]);

  const add = useCallback(async (result: SearchResult) => {
    await addVideo(result.videoId, result.title);
  }, [addVideo]);

  const addByLink = useCallback(async (raw: string): Promise<boolean> => {
    const videoId = parseYouTubeVideoId(raw);
    if (videoId === null) {
      setAddError('That is not a YouTube video link or an eleven-character video ID.');
      return false;
    }
    return addVideo(videoId, 'YouTube video');
  }, [addVideo]);

  const submit = useCallback(() => {
    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    const term = query.trim();
    if (parseYouTubeVideoId(term) !== null) {
      void addByLink(term).then((success) => {
        if (success && mounted.current) setQuery('');
      });
      return;
    }
    void search(query);
  }, [query, search, addByLink]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setSearched(false);
    setError(null);
    setSearchBlocked(false);
    setMessage(null);
    setAddError(null);
    setNotice(null);
  }, []);

  const resetNotice = useCallback(() => setNotice(null), []);
  const clearAddError = useCallback(() => setAddError(null), []);

  return {
    query,
    setQuery,
    results,
    loading,
    searched,
    available,
    searchBlocked,
    message,
    error,
    addingId,
    addError,
    addedIds,
    notice,
    submit,
    add,
    addByLink,
    clear,
    resetNotice,
    clearAddError,
    retry: submit,
  };
}
