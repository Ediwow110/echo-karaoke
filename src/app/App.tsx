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

export default function App() {
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
          <div className="entry-actions" aria-label="Room options">
            <button className="action-button action-primary" type="button">
              <span>Create room</span><span className="button-arrow" aria-hidden="true">↗</span>
            </button>
            <button className="action-button action-secondary" type="button">
              <span>Join room</span><span className="button-arrow" aria-hidden="true">→</span>
            </button>
          </div>
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
