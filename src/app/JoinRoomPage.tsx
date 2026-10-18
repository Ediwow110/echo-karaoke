import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRoomApi } from './RoomApiProvider';
import { joinRoom } from '../features/rooms/roomApi';
import { isValidRoomCode, normalizeRoomCode } from '../features/rooms/roomCode';

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
    <main className="join-shell">
      <h1>Join the room</h1>
      <p className="join-lead">
        {isValidRoomCode(code)
          ? 'Room code ' + code + '. Add your name to take the remote.'
          : 'Enter the sixteen character room code shown on the host screen.'}
      </p>

      <form className="entry-card" onSubmit={handleSubmit} aria-label="Join this room">
        <label htmlFor="code">Room code</label>
        <input
          id="code"
          name="code"
          value={code}
          onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
          placeholder="ABCD EFGH JKMN PQRS"
          autoComplete="off"
          spellCheck={false}
          maxLength={24}
          aria-invalid={code.length > 0 && !isValidRoomCode(code)}
        />

        <label htmlFor="name">Your name</label>
        <input
          id="name"
          name="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Sam"
          autoComplete="nickname"
          maxLength={32}
        />

        <button className="action-button action-primary" type="submit" disabled={!canSubmit}>
          <span>{status === 'joining' ? 'Joining' : 'Join room'}</span>
        </button>
      </form>

      {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
      {status === 'failed' ? <a className="quiet-note" href="/">Try another room</a> : null}
    </main>
  );
}
