import { useState, type FormEvent } from 'react';
import { RoomApiError } from '../../lib/edgeApi';
import { useRoomApi } from '../../app/RoomApiProvider';
import { loadGuestToken } from '../rooms/tokenStore';
import { addSong } from './queueApi';
import { scrollToQueue } from './queueAnchor';
import type { SearchResult } from '../../types/search';

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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  async function handleSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setResults([]);

    const guestToken = loadGuestToken(roomId);
    if (guestToken === null) {
      setError('This browser has no guest pass for the room.');
      return;
    }

    setBusy(true);
    try {
      const response = await api.invoke<SearchResponse>(
        'youtube-search',
        { roomId, query },
        { guestToken },
      );
      if (response.available === false) {
        setMessage(response.message ?? 'Search is not configured. Paste a YouTube link instead.');
        return;
      }
      setResults(response.results);
      if (response.results.length === 0) {
        setMessage('No videos matched that search.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The search failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(videoId: string): Promise<void> {
    setAddingId(videoId);
    setError(null);
    try {
      const song = await addSong(api, roomId, videoId);
      setMessage(song.title + ' is in the queue');
      setResults([]);
      setQuery('');
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
      <form className="entry-card" onSubmit={handleSearch} aria-label="Song search form">
        <label htmlFor="song-search">Search YouTube</label>
        <input
          id="song-search"
          name="song-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Song or artist"
          autoComplete="off"
          maxLength={100}
          disabled={disabled}
        />
        <div className="control-row">
          <button className="action-button action-secondary" type="submit" disabled={disabled || busy || query.trim().length === 0}>
            <span>{busy ? 'Searching' : 'Search'}</span>
          </button>
          <button className="action-button action-secondary" type="button" onClick={() => scrollToQueue()}>
            <span>View queue</span>
          </button>
        </div>
      </form>

      {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
      {message !== null ? <p className="quiet-note" role="status">{message}</p> : null}

      {results.length > 0 ? (
        <ul className="search-results" aria-label="Search results">
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