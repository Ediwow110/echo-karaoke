import { useState } from 'react';
import { useRoomApi } from '../../app/RoomApiProvider';
import { RoomApiError } from '../../lib/edgeApi';
import { sendPlaybackCommand, type PlaybackState } from './playbackApi';

type Props = {
  roomId: string;
  playback: PlaybackState | undefined;
  disabled?: boolean;
  onChanged?: () => void;
};

function describeError(error: unknown): string {
  if (error instanceof RoomApiError) {
    if (error.code === 'GUEST_CONTROLS_LOCKED') return 'The host locked guest controls.';
    if (error.code === 'ROOM_ENDED') return 'This room has ended.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'That playback action failed.';
}

export default function PlaybackControls({ roomId, playback, disabled = false, onChanged }: Props) {
  const api = useRoomApi();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isPlaying = playback?.isPlaying === true;

  async function run(action: 'play' | 'pause' | 'next'): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await sendPlaybackCommand(api, roomId, action);
      onChanged?.();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="playback-controls">
      <div className="control-row">
        <button
          className="action-button action-secondary"
          type="button"
          onClick={() => void run('play')}
          disabled={disabled || busy || isPlaying}
        >
          Play
        </button>
        <button
          className="action-button action-secondary"
          type="button"
          onClick={() => void run('pause')}
          disabled={disabled || busy || !isPlaying}
        >
          Pause
        </button>
        <button
          className="action-button action-primary"
          type="button"
          onClick={() => void run('next')}
          disabled={disabled || busy}
        >
          Skip
        </button>
      </div>
      {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
