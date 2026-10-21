import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KeyIcon, MicrophoneStageIcon } from '@phosphor-icons/react';
import { useRoomApi } from './RoomApiProvider';
import { joinRoom } from '../features/rooms/roomApi';
import { isValidRoomCode, normalizeRoomCode } from '../features/rooms/roomCode';
import { Button, Field } from '../ui';

type JoinStatus = 'idle' | 'joining' | 'failed';

export default function JoinRoomPage() {
  const api = useRoomApi();
  const navigate = useNavigate();
  const params = useParams<{ roomCode: string }>();
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<JoinStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = params.roomCode ?? '';
    setCode(normalizeRoomCode(raw));
  }, [params.roomCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus('joining');
    try {
      const joined = await joinRoom({ api }, code, displayName);
      navigate('/room/' + joined.roomId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That room could not be joined.');
      setStatus('failed');
    }
  }

  const canSubmit = isValidRoomCode(code) && status !== 'joining';

  return (
    <main className="grid min-h-dvh place-items-center bg-graphite px-4 py-12 text-ink">
      <div className="w-full max-w-[30rem]">
        <a href="/" className="inline-flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-media bg-signal-fill text-white">
            <MicrophoneStageIcon size={20} weight="fill" aria-hidden="true" />
          </span>
          <span className="font-display text-xl font-bold tracking-tight">encore</span>
        </a>

        <div className="mt-8 rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-[clamp(1.75rem,3.4vw,2.25rem)] font-semibold tracking-tight">Join the room</h1>
          <p className="mt-2 text-[0.9375rem] text-ink-2">
            Room code <span className="font-mono text-ink">{code}</span>. Add your name to take the remote.
          </p>

          <form onSubmit={handleSubmit} aria-label="Join this room">
            <Field
              id="code"
              label="Room code"
              value={code}
              onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
              placeholder="ABCD EFGH JKMN PQRS"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              icon={<KeyIcon size={18} weight="duotone" />}
              error={code.length > 0 && !isValidRoomCode(code) ? 'That code is not sixteen characters.' : null}
            />
            <Field
              id="name"
              label="Your name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Sam"
              autoComplete="nickname"
              maxLength={32}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              icon={<KeyIcon size={18} weight="duotone" />}
              busy={status === 'joining'}
              disabled={!canSubmit}
            >
              {status === 'joining' ? 'Joining the room' : 'Join a room'}
            </Button>
          </form>

          {error === null ? null : (
            <p role="alert" className="mt-4 rounded-media border-l-2 border-danger bg-danger/10 px-3.5 py-2.5 text-[0.875rem] text-danger">
              {error}
            </p>
          )}
          {status === 'failed' ? (
            <a href="/" className="mt-4 inline-block text-[0.8125rem] text-signal hover:underline">Try another room</a>
          ) : null}
        </div>
      </div>
    </main>
  );
}
