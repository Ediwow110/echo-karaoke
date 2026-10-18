import { useCallback, useState } from 'react';
import { RoomApiError } from '../../lib/edgeApi';
import { useRoomApi } from '../../app/RoomApiProvider';
import { loadGuestToken } from '../rooms/tokenStore';
import { addSong } from './queueApi';
import { scrollToQueue } from './queueAnchor';
import { useTypeahead } from './useTypeahead';
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const loadSuggestions = useCallback(
    async (query: string): Promise<string[]> => {
      const guestToken = loadGuestToken(roomId);
      if (guestToken === null) {
        return [];
      }
      const response = await api.invoke<SuggestResponse>('youtube-suggest', { roomId, query }, { guestToken });
      return response.suggestions;
    },
    [api, roomId],
  );

  const typeahead = useTypeahead(loadSuggestions);

  // Picking a term runs the video search and shows the matching songs.
  const chooseTerm = useCallback(
    async (term: string): Promise<void> => {
      typeahead.setQuery(term);
      setError(null);
      setMessage(null);
      setResults([]);

      const guestToken = loadGuestToken(roomId);
      if (guestToken === null) {
        setError('This browser has no guest pass for the room.');
        return;
      }

      setSearching(true);
      try {
        const response = await api.invoke<SearchResponse>('youtube-search', { roomId, query: term }, { guestToken });
        if (response.available === false) {
          setMessage('Song search needs a YouTube key. Add songs with the box below meanwhile.');
          return;
        }
        setResults(response.results);
        if (response.results.length === 0) {
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

  return (
    <div className="search-block">
      <div className="entry-card">
        <label htmlFor="song-search">Find a song on YouTube</label>
        <input
          id="song-search"
          name="song-search"
          value={typeahead.query}
          onChange={(event) => typeahead.setQuery(event.target.value)}
          placeholder="Start typing a song or artist"
          autoComplete="off"
          maxLength={100}
          disabled={disabled}
          role="combobox"
          aria-expanded={typeahead.suggestions.length > 0}
          aria-controls="song-suggestions"
          aria-autocomplete="list"
        />
        <div className="control-row">
          <button
            className="action-button action-secondary"
            type="button"
            onClick={() => void chooseTerm(typeahead.query.trim())}
            disabled={disabled || searching || typeahead.query.trim().length < 2}
          >
            <span>{searching ? 'Looking' : 'Show songs'}</span>
          </button>
          <button className="action-button action-secondary" type="button" onClick={() => scrollToQueue()}>
            <span>View queue</span>
          </button>
        </div>
      </div>

      {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
      {message !== null ? <p className="quiet-note" role="status">{message}</p> : null}

      {typeahead.suggestions.length > 0 ? (
        <ul className="suggest-list" id="song-suggestions" aria-label="Song suggestions">
          {typeahead.suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                className="suggest-item"
                type="button"
                onClick={() => void chooseTerm(suggestion)}
                disabled={disabled}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {results.length > 0 ? (
        <ul className="search-results" aria-label="Songs">
          {results.map((result) => (
            <li key={result.videoId} className="search-result">
              {result.thumbnailUrl !== null ? (
                <img className="queue-thumb" src={result.thumbnailUrl} alt="" width={72} height={40} loading="lazy" />
              ) : null}
              <span className="queue-copy">
                <span className="queue-title">{result.title}</span>
                <span className="queue-meta">{result.channelTitle ?? 'YouTube'}</span>
              </span>
              <a
                className="youtube-link"
                href={watchUrl(result.videoId)}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={'Open ' + result.title + ' on YouTube'}
              >
                YouTube
              </a>
              <button
                className="action-button action-primary"
                type="button"
                onClick={() => void handleAdd(result.videoId)}
                disabled={disabled || addingId !== null}
              >
                <span>{addingId === result.videoId ? 'Adding' : 'Queue'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
