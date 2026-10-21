import { useCallback, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon, QueueIcon } from '@phosphor-icons/react';
import { RoomApiError } from '../../lib/edgeApi';
import { useRoomApi } from '../../app/RoomApiProvider';
import { loadGuestToken } from '../rooms/tokenStore';
import { addSong } from './queueApi';
import { scrollToQueue } from './queueAnchor';
import { useTypeahead } from './useTypeahead';
import { Button, Field } from '../../ui';
import type { SearchResult } from '../../types/search';

type SuggestResponse = { suggestions: string[] };
type SearchResponse = { available: boolean; results: SearchResult[]; message?: string };

type Props = {
  roomId: string;
  disabled?: boolean;
  onAdded?: () => void;
};

export function watchUrl(videoId: string): string {
  return 'https://www.youtube.com/watch?v=' + videoId;
}

export default function SongSearch({ roomId, disabled = false, onAdded }: Props) {
  const api = useRoomApi();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [songSearchReady, setSongSearchReady] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // Runs on every typing pause: songs from YouTube plus its own autocomplete.
  const loadWhileTyping = useCallback(
    async (query: string): Promise<string[]> => {
      const guestToken = loadGuestToken(roomId);
      if (guestToken === null) {
        return [];
      }

      const [suggest, search] = await Promise.all([
        api.invoke<SuggestResponse>('youtube-suggest', { roomId, query }, { guestToken }),
        api.invoke<SearchResponse>('youtube-search', { roomId, query }, { guestToken }),
      ]);

      const ready = search.available !== false;
      setSongSearchReady(ready);
      setResults(ready ? search.results : []);

      return suggest.suggestions;
    },
    [api, roomId],
  );

  const typeahead = useTypeahead(loadWhileTyping);

  const searchNow = useCallback(
    async (term: string): Promise<void> => {
      const trimmed = term.trim();
      if (trimmed.length < 2) {
        return;
      }
      typeahead.setQuery(trimmed);
      setError(null);
      setMessage(null);

      const guestToken = loadGuestToken(roomId);
      if (guestToken === null) {
        setError('This browser has no guest pass for the room.');
        return;
      }

      setSearching(true);
      try {
        const response = await api.invoke<SearchResponse>('youtube-search', { roomId, query: trimmed }, { guestToken });
        const ready = response.available !== false;
        setSongSearchReady(ready);
        setResults(ready ? response.results : []);
        if (ready && response.results.length === 0) {
          setMessage('No songs matched that.');
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The lookup failed.');
      } finally {
        setSearching(false);
      }
    },
    [api, roomId, typeahead],
  );

  async function handleAdd(videoId: string): Promise<void> {
    setAddingId(videoId);
    setError(null);
    try {
      const song = await addSong(api, roomId, videoId);
      setMessage(song.title + ' is in the queue');
      setResults([]);
      typeahead.setQuery('');
      onAdded?.();
      scrollToQueue();
    } catch (caught) {
      if (caught instanceof RoomApiError && caught.code === 'RATE_LIMITED') {
        setError('That is five songs this minute. Wait a moment.');
      } else {
        setError(caught instanceof Error ? caught.message : 'That song could not be added.');
      }
    } finally {
      setAddingId(null);
    }
  }

  const typedEnough = typeahead.query.trim().length >= 2;

  return (
    <div className="flex flex-col gap-3">
      <Field
        id="song-search"
        label="Find a song on YouTube"
        value={typeahead.query}
        onChange={(event) => typeahead.setQuery(event.target.value)}
        placeholder="Start typing a song or artist"
        autoComplete="off"
        maxLength={100}
        disabled={disabled}
        icon={<MagnifyingGlassIcon size={18} weight="regular" />}
        role="combobox"
        aria-expanded={results.length > 0 || typeahead.suggestions.length > 0}
        aria-controls="song-options"
        aria-autocomplete="list"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<MagnifyingGlassIcon size={16} weight="bold" />}
          disabled={disabled || searching || !typedEnough}
          onClick={() => void searchNow(typeahead.query)}
        >
          {searching ? 'Looking' : 'Show songs'}
        </Button>
        <Button variant="ghost" size="sm" icon={<QueueIcon size={16} weight="duotone" />} onClick={() => scrollToQueue()}>
          View queue
        </Button>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{error}</p>
      ) : null}
      {message !== null ? <p role="status" className="text-[0.8125rem] text-ink-3">{message}</p> : null}

      {!songSearchReady && typedEnough ? (
        <p role="status" className="text-[0.8125rem] text-ink-3">
          Songs from YouTube need a data API key. Suggestions below still come from YouTube.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul id="song-options" aria-label="Songs" className="flex flex-col gap-2">
          {results.map((result) => (
            <li key={result.videoId} className="flex items-center gap-3 rounded-panel border border-line bg-surface-2 p-2.5">
              {result.thumbnailUrl !== null ? (
                <img className="h-10 w-[4.5rem] shrink-0 rounded-media object-cover" src={result.thumbnailUrl} alt="" width={72} height={40} loading="lazy" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-semibold">{result.title}</span>
                <span className="block truncate text-[0.8125rem] text-ink-3">{result.channelTitle ?? 'YouTube'}</span>
              </span>
              <a
                href={watchUrl(result.videoId)}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={'Open ' + result.title + ' on YouTube'}
                className="hidden text-[0.75rem] text-ink-3 underline hover:text-signal sm:inline"
              >
                YouTube
              </a>
              <Button
                variant="primary"
                size="sm"
                icon={<PlusIcon size={16} weight="bold" />}
                disabled={disabled || addingId !== null}
                onClick={() => void handleAdd(result.videoId)}
              >
                {addingId === result.videoId ? 'Adding' : 'Queue'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {results.length === 0 && typeahead.suggestions.length > 0 ? (
        <ul id="song-options" aria-label="Song suggestions" className="flex flex-col gap-1.5">
          {typeahead.suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => void searchNow(suggestion)}
                disabled={disabled}
                className="w-full rounded-panel border border-line bg-surface-2 px-3.5 py-2.5 text-left text-[0.875rem] text-ink transition-colors hover:border-signal/40 hover:bg-surface-3 disabled:opacity-40"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
