import { useState } from 'react';
import { PauseIcon, PlayIcon, SkipForwardIcon } from '@phosphor-icons/react';
import { useRoomApi } from '../../app/RoomApiProvider';
import { RoomApiError } from '../../lib/edgeApi';
import { sendPlaybackCommand, type PlaybackState } from './playbackApi';
import { TransportButton } from '../../ui';

type Props = {
  roomId: string;
  playback: PlaybackState | undefined;
  disabled?: boolean;
  shape?: 'dock' | 'bar';
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

export default function PlaybackControls({ roomId, playback, disabled = false, shape = 'bar', onChanged }: Props) {
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
    <div className="flex flex-col gap-2">
      <span className={['flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-3', shape === 'dock' ? 'justify-center' : ''].join(' ')}>
        <span
          aria-hidden="true"
          className={['size-2 rounded-full', isPlaying ? 'animate-presence-pulse bg-live' : 'bg-ink-3'].join(' ')}
        />
        {isPlaying ? 'Playing' : 'Paused'}
      </span>
      <div className={shape === 'dock' ? 'flex items-center justify-center gap-3' : 'flex flex-wrap items-center gap-2'}>
        <TransportButton
          shape={shape}
          label="Play"
          icon={<PlayIcon size={20} weight="fill" />}
          disabled={disabled || busy || isPlaying}
          onClick={() => void run('play')}
        />
        <TransportButton
          shape={shape}
          label="Pause"
          icon={<PauseIcon size={20} weight="fill" />}
          disabled={disabled || busy || !isPlaying}
          onClick={() => void run('pause')}
        />
        <TransportButton
          shape={shape}
          label="Skip"
          icon={<SkipForwardIcon size={20} weight="fill" />}
          disabled={disabled || busy}
          onClick={() => void run('next')}
        />
      </div>
      {error === null ? null : (
        <p role="alert" className="rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
