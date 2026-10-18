import { useState, type FormEvent } from 'react';
import { RoomApiError } from '../../lib/edgeApi';
import { parseYouTubeVideoId } from './youtubeVideo';
import { addSong } from './queueApi';
import { scrollToQueue } from './queueAnchor';
import { useRoomApi } from '../../app/RoomApiProvider';

type Props = {
  roomId: string;
  disabled?: boolean;
  onAdded?: () => void;
};

function describeError(error: unknown): string {
  if (error instanceof RoomApiError) {
    if (error.code === 'RATE_LIMITED') return 'That is five songs this minute. Wait a moment.';
    if (error.code === 'GUEST_CONTROLS_LOCKED') return 'The host locked guest controls.';
    if (error.code === 'METADATA_UNAVAILABLE') return 'That video could not be read. Check the link.';
    if (error.code === 'ROOM_ENDED') return 'This room has ended.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'That song could not be added.';
}

export default function PasteSongForm({ roomId, disabled = false, onAdded }: Props) {
  const api = useRoomApi();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const videoId = parseYouTubeVideoId(value);
    if (videoId === null) {
      setError('Paste a YouTube link or an eleven character video id.');
      return;
    }

    setBusy(true);
    try {
      const song = await addSong(api, roomId, videoId);
      setValue('');
      setNotice(song.title + ' is in the queue');
      onAdded?.();
      scrollToQueue();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entry-card" onSubmit={handleSubmit} aria-label="Add a song by link">
      <label htmlFor="song-link">Paste a YouTube link</label>
      <input
        id="song-link"
        name="song-link"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://youtu.be/..."
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
      />
      <button className="action-button action-primary" type="submit" disabled={disabled || busy}>
        <span>{busy ? 'Adding' : 'Add to queue'}</span>
      </button>
      {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
      {notice !== null ? <p className="quiet-note" role="status">{notice}</p> : null}
    </form>
  );
}
