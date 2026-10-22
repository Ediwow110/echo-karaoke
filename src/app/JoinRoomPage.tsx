import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, KeyIcon, QrCodeIcon } from '@phosphor-icons/react';
import { useRoomApi } from './RoomApiProvider';
import { joinRoom } from '../features/rooms/roomApi';
import { isValidRoomCode, normalizeRoomCode } from '../features/rooms/roomCode';
import { getHostSessionByCode, getStoredProfileName, rememberSession, saveProfileName } from '../features/rooms/sessionStore';
import { RoomApiError } from '../lib/edgeApi';
import { Button, Field, Logo } from '../ui';

export default function JoinRoomPage() {
  const api = useRoomApi();
  const navigate = useNavigate();
  const params = useParams<{ roomCode?: string }>();
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState(() => getStoredProfileName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCode(normalizeRoomCode(params.roomCode ?? ''));
  }, [params.roomCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!isValidRoomCode(code)) {
      setError('That room code is not sixteen characters.');
      return;
    }
    setBusy(true);
    try {
      const joined = await joinRoom({ api }, code, displayName);
      saveProfileName(joined.displayName);
      rememberSession({
        roomId: joined.roomId,
        code: joined.roomCode,
        roomName: joined.roomName,
        hostName: 'Host',
        role: 'guest',
      });
      navigate('/room/' + joined.roomId);
    } catch (caught) {
      if (caught instanceof RoomApiError && caught.code === 'HOST_ALREADY_IN_ROOM') {
        const hostSession = getHostSessionByCode(code);
        if (hostSession !== null) {
          navigate('/room/' + hostSession.roomId + '/host');
          return;
        }
      }
      setError(caught instanceof Error ? caught.message : 'That room could not be joined.');
    } finally {
      setBusy(false);
    }
  }

  const knownCode = (params.roomCode ?? '').length > 0;

  return (
    <main className="page-enter min-h-dvh bg-graphite px-4 pb-12 pt-7 text-ink">
      <div className="mx-auto w-full max-w-[27rem]">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" aria-label="ECHO home" className="inline-flex min-h-11 items-center">
            <Logo size="md" />
          </Link>
          <Link to="/scan" className="inline-flex min-h-11 items-center gap-1.5 text-[0.6875rem] font-semibold text-ink-2 hover:text-ink">
            <QrCodeIcon size={15} weight="duotone" aria-hidden="true" />
            Scan instead
          </Link>
        </div>

        <div className="mt-10">
          <p className="eyebrow text-gold">{knownCode ? 'You were invited' : 'Phone remote'}</p>
          <h1 className="mt-2 font-display text-[2.55rem] font-bold leading-[1.02] tracking-[-0.045em]">
            Join the room.
          </h1>
          <p className="mt-2 max-w-[34ch] text-[0.8125rem] leading-[1.65] text-ink-2">
            Add your name to take the remote. No account, no app, no install.
          </p>
        </div>

        <div className="mt-7 rounded-panel border border-line bg-surface p-5 sm:p-6">
          <form onSubmit={handleSubmit} aria-label="Join this room" className="flex flex-col gap-4">
            <Field
              id="code"
              label="Room code"
              value={code}
              onChange={(event) => {
                setCode(normalizeRoomCode(event.target.value));
                setError(null);
              }}
              placeholder="ABCD EFGH JKMN PQRS"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              icon={<KeyIcon size={17} weight="duotone" />}
              hint={knownCode ? 'The room code from the host screen.' : 'Ask the host for the sixteen character code.'}
              error={code.length > 0 && !isValidRoomCode(code) ? 'That code is not sixteen characters.' : null}
            />
            <Field
              id="name"
              label="Your name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Jamie"
              autoComplete="nickname"
              maxLength={32}
            />
            <Button
              type="submit"
              variant={isValidRoomCode(code) ? 'primary' : 'secondary'}
              size="lg"
              full
              className="mt-1"
              icon={<KeyIcon size={16} weight="duotone" />}
              busy={busy}
              disabled={!isValidRoomCode(code)}
            >
              Join room
            </Button>
            {error === null ? null : (
              <p role="alert" className="rounded-media border border-danger/30 bg-danger-soft/50 px-3.5 py-2.5 text-[0.8125rem] text-danger">
                {error}
              </p>
            )}
          </form>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 text-[0.75rem] text-ink-2 hover:text-ink">
            <ArrowLeftIcon size={13} weight="bold" aria-hidden="true" />
            Back
          </Link>
          <p className="text-[0.625rem] text-ink-3">Your name shows in the room roster.</p>
        </div>
      </div>
    </main>
  );
}
