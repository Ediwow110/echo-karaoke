import { useState, type FormEvent } from 'react';
import { LinkIcon, PlusIcon } from '@phosphor-icons/react';
import { RoomApiError } from '../../lib/edgeApi';
import { parseYouTubeVideoId } from './youtubeVideo';
import { addSong } from './queueApi';
import { scrollToQueue } from './queueAnchor';
import { useRoomApi } from '../../app/RoomApiProvider';
import { Button, Field } from '../../ui';

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
    <form onSubmit={handleSubmit} aria-label="Add a song by link">
      <Field
        id="song-link"
        label="Paste a YouTube link"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://youtu.be/..."
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        icon={<LinkIcon size={18} weight="regular" />}
        error={error}
      />
      <Button
        type="submit"
        variant="secondary"
        size="md"
        className="mt-3"
        icon={<PlusIcon size={16} weight="bold" />}
        disabled={disabled || busy}
        busy={busy}
      >
        {busy ? 'Adding' : 'Add to queue'}
      </Button>
      {notice === null ? null : (
        <p role="status" className="mt-2 text-[0.8125rem] text-ink-3">{notice}</p>
      )}
    </form>
  );
}
