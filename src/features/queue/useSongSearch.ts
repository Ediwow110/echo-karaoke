import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomApi } from '../../app/RoomApiProvider';
import { RoomApiError } from '../../lib/edgeApi';
import { loadGuestToken } from '../rooms/tokenStore';
import { addSong, type QueueSong } from './queueApi';
import type { SearchResult } from '../../types/search';

type SearchResponse = { available: boolean; results: SearchResult[]; message?: string };

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<SongNotice | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const addedTimers = useRef(new Map<string, number>());

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

    const guestToken = loadGuestToken(roomId);
    if (guestToken === null) {
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
        { guestToken },
      );
      if (!mounted.current || requestId.current !== current) {
        return;
      }
      const ready = response.available !== false;
      setAvailable(ready);
      setResults(ready ? (response.results ?? []) : []);
      setMessage(ready ? null : (response.message ?? 'Search is not configured. Paste a YouTube link instead.'));
    } catch (caught) {
      if (!mounted.current || requestId.current !== current) {
        return;
      }
      const fallback = caught instanceof Error ? caught.message : 'The lookup failed.';
      setResults([]);
      setError(caught instanceof RoomApiError && caught.code === 'NETWORK_ERROR'
        ? 'YouTube search is unreachable right now. Paste a link instead.'
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
      setMessage(null);
      setError(null);
      return;
    }
    requestId.current += 1;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void search(query);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  const submit = useCallback(() => {
    void search(query);
  }, [query, search]);

  const add = useCallback(async (result: SearchResult) => {
    if (disabled) {
      setAddError('The host turned off guest requests.');
      return;
    }
    setAddingId(result.videoId);
    setAddError(null);
    setNotice(null);
    try {
      const song = await addSong(api, roomId, result.videoId);
      setAddedIds((current) => current.includes(result.videoId) ? current : [...current, result.videoId]);
      setNotice({ title: song.title || result.title, position: song.position ?? null, videoId: result.videoId });
      const previous = addedTimers.current.get(result.videoId);
      if (previous !== undefined) {
        window.clearTimeout(previous);
      }
      addedTimers.current.set(result.videoId, window.setTimeout(() => {
        addedTimers.current.delete(result.videoId);
        if (mounted.current) {
          setAddedIds((current) => current.filter((videoId) => videoId !== result.videoId));
        }
      }, 12000));
      onAdded?.(song);
    } catch (caught) {
      setAddError(describeAddError(caught));
    } finally {
      if (mounted.current) {
        setAddingId(null);
      }
    }
  }, [api, disabled, onAdded, roomId]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setSearched(false);
    setError(null);
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
    message,
    error,
    addingId,
    addError,
    addedIds,
    notice,
    submit,
    add,
    clear,
    resetNotice,
    clearAddError,
    retry: submit,
  };
}
