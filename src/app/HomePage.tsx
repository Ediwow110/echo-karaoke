import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { MicrophoneStageIcon } from '@phosphor-icons/react/dist/csr/MicrophoneStage';
import { MonitorPlayIcon } from '@phosphor-icons/react/dist/csr/MonitorPlay';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { QrCodeIcon } from '@phosphor-icons/react/dist/csr/QrCode';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { useRoomApi } from './RoomApiProvider';
import { createRoom, joinRoom } from '../features/rooms/roomApi';
import { isValidRoomCode, normalizeRoomCode } from '../features/rooms/roomCode';
import { getStoredProfileName, getHostSessionByCode, rememberSession, saveProfileName } from '../features/rooms/sessionStore';
import { RoomApiError } from '../lib/edgeApi';
import { useMediaQuery } from '../lib/useMediaQuery';
import AppShell from '../features/rooms/AppShell';
import { Avatar, Button, Field, Logo, Toggle } from '../ui';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

const steps = [
  { number: '01', title: 'Create your room', body: 'Give the night a name. You stay in control.' },
  { number: '02', title: 'Pick a song. Click play.', body: 'Search YouTube, then start playback on this host screen.' },
  { number: '03', title: 'Scan. Join. Pass the mic.', body: 'Guests scan the room QR and immediately get a phone remote.' },
  { number: '04', title: 'Let the queue take over', body: 'Phones search and add songs. The shared queue advances automatically.' },
];

function hostNameDefault(): string {
  return getStoredProfileName();
}

export default function HomePage() {
  const api = useRoomApi();
  const navigate = useNavigate();
  // A screen is wide only when both edges reach 640px. The shorter edge, not
  // the width alone, decides whether this device is a phone remote.
  const wide = useMediaQuery('(min-width: 640px) and (min-height: 640px)');
  const [mode, setMode] = useState<'join' | 'host'>('join');
  const [roomName, setRoomName] = useState('');
  const [hostName, setHostName] = useState(hostNameDefault);
  const [guestsCanAdd, setGuestsCanAdd] = useState(true);
  const [guestPlayback, setGuestPlayback] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [guestName, setGuestName] = useState(hostNameDefault);
  const [hostNameError, setHostNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setHostNameError(null);
    if (hostName.trim().length === 0) {
      setHostNameError('Add the name guests will see.');
      return;
    }
    setBusy('create');
    try {
      const finalName = roomName.trim().length > 0 ? roomName.trim() : hostName.trim() + "'s room";
      const created = await createRoom({ api }, hostName, {
        roomName: finalName,
        guestsCanAdd,
        guestsCanControlPlayback: guestPlayback,
      });
      saveProfileName(created.displayName);
      rememberSession({
        roomId: created.roomId,
        code: created.roomCode,
        roomName: created.roomName,
        hostName: created.displayName,
        role: 'host',
      });
      navigate('/room/' + created.roomId + '/host');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!isValidRoomCode(joinCode)) {
      setError('That room code is not sixteen characters.');
      return;
    }
    setBusy('join');
    try {
      const joined = await joinRoom({ api }, joinCode, guestName);
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
        const hostSession = getHostSessionByCode(joinCode);
        if (hostSession !== null) {
          navigate('/room/' + hostSession.roomId + '/host');
          return;
        }
      }
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  if (!wide) {
    return (
      <main className="page-enter min-h-dvh bg-graphite px-4 pb-12 pt-7 text-ink">
        <div className="mx-auto w-full max-w-[26rem]">
          <Logo size="md" />
          <div className="mt-10">
            <p className="eyebrow text-gold">{mode === 'join' ? 'Phone remote' : 'Host setup'}</p>
            <h1 className="mt-2 font-display text-[2.35rem] font-bold leading-[1.02] tracking-[-0.04em]">
              {mode === 'join' ? 'Join the room.' : 'Make it your room.'}
            </h1>
            <p className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
              {mode === 'join'
                ? 'Enter the room code from the host screen, add your name, and take the remote.'
                : 'Start a room on a big screen. Everyone else brings their phone and their next song.'}
            </p>
          </div>

          <div key={mode} className="page-enter">
            {mode === 'join' ? (
              <form onSubmit={handleJoin} className="mt-7 flex flex-col gap-4" data-join-card aria-label="Join a room">
              <Field
                id="join-code"
                label="Room code"
                value={joinCode}
                onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
                placeholder="ABCD EFGH JKMN PQRS"
                autoComplete="off"
                spellCheck={false}
                maxLength={24}
                icon={<KeyIcon size={17} weight="duotone" />}
                error={joinCode.length > 0 && !isValidRoomCode(joinCode) ? 'That code is not sixteen characters.' : null}
              />
              <Field
                id="join-name"
                label="Your name"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder="Jamie"
                autoComplete="nickname"
                maxLength={32}
              />
              <Button
                type="submit"
                variant={isValidRoomCode(joinCode) ? 'primary' : 'secondary'}
                size="lg"
                full
                icon={<KeyIcon size={16} weight="duotone" />}
                busy={busy === 'join'}
                disabled={!isValidRoomCode(joinCode)}
              >
                Join room
              </Button>
              <Link
                to="/scan"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-media border border-line bg-surface text-[0.8125rem] font-semibold text-ink hover:border-line-strong"
              >
                <QrCodeIcon size={17} weight="duotone" aria-hidden="true" />
                Scan the room QR
              </Link>
            </form>
          ) : (
            <form onSubmit={handleCreate} className="mt-7 flex flex-col gap-4" data-start-card aria-label="Start a room">
              <Field
                id="mobile-room-name"
                label="Room name"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="After Hours"
                maxLength={48}
                hint="Guests see this on their phone."
              />
              <Field
                id="mobile-host-name"
                label="Your name"
                value={hostName}
                onChange={(event) => setHostName(event.target.value)}
                placeholder="Alex"
                autoComplete="nickname"
                maxLength={32}
                error={hostNameError}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                full
                icon={<PlusIcon size={16} weight="bold" />}
                busy={busy === 'create'}
              >
                Create room
              </Button>
              <p className="text-[0.6875rem] leading-[1.6] text-ink-2">
                The host screen plays video and audio. Add the first song after the room opens.
              </p>
              </form>
            )}
          </div>

          {error === null ? null : (
            <p role="alert" className="mt-4 rounded-media border border-danger/30 bg-danger-soft/50 px-3.5 py-2.5 text-[0.8125rem] text-danger">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'join' ? 'host' : 'join');
              setError(null);
            }}
            className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-[0.75rem] font-semibold text-signal hover:underline"
          >
            {mode === 'join' ? 'Hosting tonight? Create a room' : 'Joining instead? Use a room code'}
            <ArrowRightIcon size={12} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </main>
    );
  }

  const resolvedHost = hostName.trim().length > 0 ? hostName.trim() : 'You';

  return (
    <AppShell
      activeNav="create"
      activeRoom={null}
      hostName={hostName.trim().length > 0 ? hostName.trim() : getStoredProfileName() || 'Host'}
      mobileAction={<Link to="/scan" className="inline-flex min-h-11 items-center text-[0.75rem] font-semibold text-signal">Scan a code</Link>}
    >
      <main className="mx-auto w-full max-w-[1240px] px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5 animate-console-in">
          <div>
            <p className="eyebrow text-gold">YouTube karaoke room</p>
            <h1 className="mt-1 font-display text-[1.55rem] font-bold tracking-[-0.02em] text-ink">Create room</h1>
          </div>
          <span className="rounded-full border border-signal/25 bg-signal-soft px-3 py-1.5 text-[0.625rem] font-semibold text-signal">
            {hostName.trim().length > 0 ? hostName.trim() + ' · Host setup' : 'Host setup'}
          </span>
        </header>

        <section className="mt-8 animate-console-in" style={{ animationDelay: '60ms' }} aria-labelledby="create-title">
          <h2 id="create-title" className="font-display text-[clamp(2rem,2.8vw,2.25rem)] font-bold leading-[1.08] tracking-[-0.035em] text-ink">
            Good company. Great choruses.
          </h2>
          <p className="mt-3 max-w-[62ch] text-[0.8125rem] leading-[1.65] text-ink-2">
            Start a room on this screen. Everyone else brings their phone — and their next song.
          </p>
        </section>

        <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]">
          <form
            onSubmit={handleCreate}
            className="animate-console-in rounded-panel border border-line bg-surface p-5 sm:p-6"
            style={{ animationDelay: '120ms' }}
            data-start-card
            aria-label="Start a room"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-[1.65rem] font-bold tracking-[-0.025em] text-ink">Make it your room.</h2>
              <SlidersHorizontalIcon size={19} className="text-signal" aria-hidden="true" />
            </div>

            <div className="mt-5 flex flex-col gap-4">
              <Field
                id="create-room-name"
                label="Room name"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="After Hours"
                maxLength={48}
                hint="This is the name guests see on their phone."
              />
              <Field
                id="create-host-name"
                label="Your name"
                value={hostName}
                onChange={(event) => {
                  setHostName(event.target.value);
                  setHostNameError(null);
                }}
                placeholder="Alex"
                autoComplete="nickname"
                maxLength={32}
                error={hostNameError}
              />
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-media border border-line bg-graphite/50 px-3.5 py-3">
              <Avatar name={resolvedHost} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-semibold text-ink">
                  {hostName.trim().length > 0 ? hostName.trim() + " · You're the host" : "You're the host"}
                </p>
                <p className="mt-0.5 text-[0.6875rem] text-ink-2">Video and audio will play on this display.</p>
              </div>
              <MonitorPlayIcon size={18} className="text-ink-2" aria-hidden="true" />
            </div>

            <div className="mt-6">
              <p className="eyebrow text-ink-2">Guest permissions</p>
              <div className="mt-4 flex flex-col gap-4">
                <Toggle
                  checked={guestsCanAdd}
                  onChange={setGuestsCanAdd}
                  label="Guests can add songs"
                  description="Let everyone search YouTube and add to the shared queue."
                  disabled={busy !== null}
                />
                <div className="h-px bg-line" aria-hidden="true" />
                <Toggle
                  checked={guestPlayback}
                  onChange={setGuestPlayback}
                  label="Guest playback controls"
                  description="Off by default. Only you can pause or resume playback."
                  disabled={busy !== null}
                />
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-media border border-line px-3.5 py-2.5">
                <KeyIcon size={14} className="text-ink-2" aria-hidden="true" />
                <p className="text-[0.6875rem] text-ink-2">Skip, remove and reorder are always host-only.</p>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              full
              className="mt-5"
              icon={<ArrowRightIcon size={16} weight="bold" />}
              busy={busy === 'create'}
            >
              Create room
            </Button>
            <p className="mt-3 text-[0.6875rem] leading-[1.6] text-ink-2">
              Next: search for your first song, start YouTube playback and share your room QR. The host screen owns the music.
            </p>
            {error === null ? null : (
              <p role="alert" className="mt-3 rounded-media border border-danger/30 bg-danger-soft/50 px-3.5 py-2.5 text-[0.8125rem] text-danger">
                {error}
              </p>
            )}
          </form>

          <aside className="animate-console-in flex flex-col overflow-hidden rounded-panel border border-line bg-surface" style={{ animationDelay: '180ms' }}>
            <div className="relative h-[11.5rem] shrink-0">
              <img
                src="/images/stage-spotlight.jpg"
                alt="An empty stage under a warm spotlight"
                width={1600}
                height={534}
                fetchPriority="high"
                className="stage-pan absolute inset-0 h-full w-full object-cover"
              />
              <div className="stage-smoke absolute inset-0" aria-hidden="true" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,13,24,0.15),rgba(16,13,24,0.9))]" aria-hidden="true" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <p className="eyebrow text-gold">One host screen. Everyone in.</p>
                <p className="mt-2 font-display text-[1.8rem] font-bold leading-[1.02] tracking-[-0.03em] text-ink">Your screen is the stage.</p>
              </div>
            </div>
            <div className="p-5">
              <ol className="flex flex-col gap-4">
                {steps.map((step) => (
                  <li key={step.number} className="flex gap-3">
                    <span className="w-6 shrink-0 font-display text-[0.75rem] tabular text-signal">{step.number}</span>
                    <div>
                      <p className="text-[0.8125rem] font-semibold text-ink">{step.title}</p>
                      <p className="mt-0.5 text-[0.6875rem] leading-[1.55] text-ink-2">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-5 rounded-media border border-line bg-graphite/60 p-4">
                <p className="text-[0.75rem] font-semibold text-ink">The music stays on the host display.</p>
                <p className="mt-1 text-[0.6875rem] leading-[1.6] text-ink-2">
                  Phones are remotes for Search and Queue, not a second audio source.
                </p>
              </div>
            </div>
          </aside>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[0.6875rem] text-ink-2">
          <p className="flex items-center gap-2">
            <MicrophoneStageIcon size={15} className="text-signal" aria-hidden="true" />
            More room settings are available after creation. Change guest permissions whenever you need.
          </p>
          <Link to="/join" className="font-semibold text-signal hover:underline">Have a room code? Join a room</Link>
        </div>
      </main>
    </AppShell>
  );
}
