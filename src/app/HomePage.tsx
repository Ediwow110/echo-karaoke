import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoomApi } from './RoomApiProvider';
import { createRoom, joinRoom } from '../features/rooms/roomApi';

const notes = ['No accounts', 'One shared queue', 'All voices welcome'];

function NoteMark() {
  return (
    <svg aria-hidden="true" className="note-mark" viewBox="0 0 36 36" fill="none">
      <path d="M22.7 6v18.1a5.2 5.2 0 1 1-2.8-4.6V11l12-2.7v12.4a5.2 5.2 0 1 1-2.8-4.6V5l-6.4 1Z" fill="currentColor" />
      <path d="M5 18h5m-2.5-2.5v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function SoundLines() {
  return (
    <svg aria-hidden="true" className="sound-lines" viewBox="0 0 220 122" fill="none">
      <path d="M8 62h18l10-29 13 59 14-79 14 98 14-74 12 53 13-70 14 53 12-35 11 25h22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

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
    <main className="home-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Encore home">
          <span className="wordmark-icon"><NoteMark /></span>
          <span>encore<span className="wordmark-period">.</span></span>
        </a>
        <span className="topbar-note">A little louder, together</span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" aria-hidden="true" /> YOUR LIVING ROOM, FRONT ROW</p>
          <h1 id="hero-title">Every song<br />deserves an <em>encore.</em></h1>
          <p className="hero-description">Pick a song. Pass the mic. Make a night of it.<br className="desktop-break" /> Your people are already halfway there.</p>

          <div className="entry-forms">
            <form className="entry-card" onSubmit={handleCreate} aria-label="Create a room">
              <label htmlFor="create-name">Host name</label>
              <input
                id="create-name"
                name="create-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Ana"
                autoComplete="nickname"
                maxLength={32}
              />
              <button className="action-button action-primary" type="submit" disabled={busy !== null}>
                <span>Create room</span><span className="button-arrow" aria-hidden="true">↗</span>
              </button>
            </form>

            <form className="entry-card" onSubmit={handleJoin} aria-label="Join a room">
              <label htmlFor="join-code">Room code</label>
              <input
                id="join-code"
                name="join-code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder="ABCD EFGH JKMN PQRS"
                autoComplete="off"
                spellCheck={false}
                maxLength={24}
              />
              <label htmlFor="join-name">Guest name</label>
              <input
                id="join-name"
                name="join-name"
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                placeholder="Sam"
                autoComplete="nickname"
                maxLength={32}
              />
              <button className="action-button action-secondary" type="submit" disabled={busy !== null}>
                <span>Join room</span><span className="button-arrow" aria-hidden="true">→</span>
              </button>
            </form>
          </div>

          {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
          <p className="quiet-note">No sign-up. Just show up.</p>
        </div>

        <div className="hero-art" aria-label="An illustrated microphone and sound waves" role="img">
          <div className="art-stamp"><span>LIVE</span><span className="stamp-star" aria-hidden="true" /></div>
          <div className="art-sun" />
          <div className="art-floor" />
          <div className="microphone"><span className="mic-grille" /><span className="mic-neck" /><span className="mic-base" /></div>
          <SoundLines />
          <span className="art-caption">ONE MORE SONG</span>
          <span className="art-number">01 / 01</span>
        </div>
      </section>

      <footer className="bottomline">
        <p>GOOD SONGS. QUESTIONABLE HIGH NOTES.</p>
        <ul aria-label="How Encore works">
          {notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </footer>
    </main>
  );
}
