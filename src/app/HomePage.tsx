import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BroadcastIcon,
  KeyIcon,
  ListIcon,
  MicrophoneStageIcon,
  MusicNoteIcon,
  QrCodeIcon,
} from '@phosphor-icons/react';
import { useRoomApi } from './RoomApiProvider';
import { createRoom, joinRoom } from '../features/rooms/roomApi';
import { Button, Field } from '../ui';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

const steps = [
  { icon: BroadcastIcon, label: 'Start', note: 'Open a room on the big screen' },
  { icon: QrCodeIcon, label: 'Invite', note: 'Send the code or the link' },
  { icon: MusicNoteIcon, label: 'Sing', note: 'Queue a song from any phone' },
];

export default function HomePage() {
  const api = useRoomApi();
  const navigate = useNavigate();
  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy('create');
    try {
      const created = await createRoom({ api }, createName);
      navigate('/room/' + created.roomId + '/host');
    } catch (caught) {
      setError(describeError(caught));
      setBusy(null);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy('join');
    try {
      const joined = await joinRoom({ api }, joinCode, joinName);
      navigate('/room/' + joined.roomId);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(null);
    }
  }

  return (
    <main className="min-h-dvh bg-graphite text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-graphite/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-media bg-signal-fill text-white">
              <MicrophoneStageIcon size={20} weight="fill" aria-hidden="true" />
            </span>
            <span className="font-display text-xl font-bold tracking-tight">encore</span>
          </a>
          <a href="#how" className="inline-flex items-center gap-2 text-[0.875rem] text-ink-2 transition-colors hover:text-ink">
            <ListIcon size={18} weight="duotone" aria-hidden="true" />
            How it works
          </a>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1400px] gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:pb-24 lg:pt-20">
        <div className="max-w-[42rem]">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-signal">Live on YouTube</p>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
            One room. Every voice.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[0.9375rem] leading-relaxed text-ink-2">
            Open a room, send the code, and everyone sings from their own phone. One shared queue, one screen for the music.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <form onSubmit={handleCreate} className="rounded-panel border border-line bg-surface p-6" aria-label="Start a room">
              <span className="grid size-10 place-items-center rounded-media bg-signal-soft text-signal">
                <BroadcastIcon size={22} weight="duotone" aria-hidden="true" />
              </span>
              <h2 className="mt-4 font-display text-lg font-semibold tracking-tight">Start a room</h2>
              <p className="mt-1 text-[0.8125rem] text-ink-3">You host on the big screen.</p>
              <Field
                id="create-name"
                label="Host name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Ana"
                autoComplete="nickname"
                maxLength={32}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="mt-4 w-full"
                icon={<BroadcastIcon size={18} weight="duotone" />}
                busy={busy === 'create'}
              >
                {busy === 'create' ? 'Starting the room' : 'Start a room'}
              </Button>
            </form>

            <form onSubmit={handleJoin} className="rounded-panel border border-line bg-surface p-6" aria-label="Join a room">
              <span className="grid size-10 place-items-center rounded-media bg-signal-soft text-signal">
                <KeyIcon size={22} weight="duotone" aria-hidden="true" />
              </span>
              <h2 className="mt-4 font-display text-lg font-semibold tracking-tight">Join a room</h2>
              <p className="mt-1 text-[0.8125rem] text-ink-3">Scan the code on the host screen, or type it.</p>
              <a
                href="/scan"
                className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-panel border border-line bg-surface-2 px-4 text-[0.875rem] font-semibold text-ink transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console) hover:-translate-y-px hover:border-line-strong hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <QrCodeIcon size={18} weight="duotone" aria-hidden="true" />
                Scan a code
              </a>
              <Field
                id="join-code"
                label="Room code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder="ABCD EFGH JKMN PQRS"
                autoComplete="off"
                spellCheck={false}
                maxLength={24}
              />
              <Field
                id="join-name"
                label="Guest name"
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                placeholder="Sam"
                autoComplete="nickname"
                maxLength={32}
              />
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                className="mt-4 w-full"
                icon={<KeyIcon size={18} weight="duotone" />}
                busy={busy === 'join'}
              >
                {busy === 'join' ? 'Joining the room' : 'Join a room'}
              </Button>
            </form>
          </div>

          {error === null ? null : (
            <p role="alert" className="mt-4 rounded-media border-l-2 border-danger bg-danger/10 px-3.5 py-2.5 text-[0.875rem] text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="lg:pl-4">
          <div className="relative overflow-hidden rounded-panel border border-line">
            <img
              src="/images/hero-microphone.jpg"
              alt="A vintage chrome microphone on a lit stage"
              width={1600}
              height={2000}
              fetchPriority="high"
              className="aspect-[4/5] w-full object-cover grayscale"
            />
            <span aria-hidden="true" className="absolute inset-0 bg-signal/85 mix-blend-color" />
            <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,11,14,0.05),rgba(10,11,14,0.92))]" />
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {steps.map((step) => (
              <li key={step.label} className="rounded-panel border border-line bg-surface p-4">
                <step.icon size={22} weight="duotone" className="text-signal" aria-hidden="true" />
                <p className="mt-3 font-display text-[0.9375rem] font-semibold">{step.label}</p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-3">{step.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className="border-t border-line bg-graphite-soft">
        <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <h2 className="font-display text-[clamp(1.75rem,3.4vw,2.25rem)] font-semibold tracking-tight">
                The host owns the screen. The guests own the queue.
              </h2>
              <p className="mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-ink-2">
                The host screen plays the music and shows the queue. Every guest searches YouTube from their own phone, votes for the next track and holds the remote. No account, no install, one room code.
              </p>
            </div>
            <div className="relative overflow-hidden rounded-panel border border-line">
              <img
                src="/images/singer-stage.jpg"
                alt="A singer on stage under blue light"
                width={1600}
                height={1067}
                loading="lazy"
                className="aspect-[3/2] w-full object-cover grayscale"
              />
              <span aria-hidden="true" className="absolute inset-0 bg-signal/85 mix-blend-color" />
              <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,11,14,0.05),rgba(10,11,14,0.7))]" />
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[0.8125rem] text-ink-3 sm:px-6">
          <p>Encore. A shared stage for songs worth singing together.</p>
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">No accounts. No install. One code.</p>
        </div>
      </footer>
    </main>
  );
}
