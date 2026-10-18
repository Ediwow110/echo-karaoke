import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { useRoomData } from '../features/rooms/useRoomData';
import { useRoomApi } from './RoomApiProvider';
import { sendHostCommand } from '../features/rooms/roomApi';
import { removeSong } from '../features/queue/queueApi';
import { buildJoinUrl } from '../features/rooms/roomUrl';
import ParticipantRoster from '../features/rooms/ParticipantRoster';
import QueueList from '../features/queue/QueueList';
import PasteSongForm from '../features/queue/PasteSongForm';
import SongSearch from '../features/queue/SongSearch';
import PlaybackControls from '../features/playback/PlaybackControls';
import YouTubePlayer from '../features/playback/YouTubePlayer';
import { youtubePlayerFactory } from '../features/playback/youtubeIframe';
import { reportPlaybackPosition } from '../features/playback/playbackApi';

export default function HostRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const api = useRoomApi();
  const { data, error, loading, refresh } = useRoomData(roomId, 'host');
  const [qrSvg, setQrSvg] = useState<string>('');
  const [commandError, setCommandError] = useState<string | null>(null);

  const code = data?.room?.code ?? '';
  const joinUrl = code.length > 0 ? buildJoinUrl(window.location.origin, code) : '';

  useEffect(() => {
    if (joinUrl.length === 0) {
      setQrSvg('');
      return;
    }
    let cancelled = false;
    void QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 220 })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  async function runPlayback(action: 'play' | 'pause' | 'next'): Promise<void> {
    const { sendPlaybackCommand } = await import('../features/playback/playbackApi');
    try {
      await sendPlaybackCommand(api, roomId, action);
      await refresh();
    } catch {
      // The player retries on the next invalidation.
    }
  }

  async function runCommand(action: 'lock' | 'unlock' | 'end' | 'clear_queue'): Promise<void> {
    setCommandError(null);
    try {
      await sendHostCommand(api, roomId, action);
      await refresh();
    } catch (caught) {
      setCommandError(caught instanceof Error ? caught.message : 'That command failed.');
    }
  }

  if (loading) {
    return <main className="room-shell"><p role="status">Loading the room</p></main>;
  }

  if (error !== null) {
    return (
      <main className="room-shell">
        <h1>Host controls unavailable</h1>
        <p className="form-error" role="alert">{error}</p>
        <a className="action-button action-secondary" href="/">Back to start</a>
      </main>
    );
  }

  if (data === null || data.status === 'ended') {
    return (
      <main className="room-shell">
        <h1>This room has ended</h1>
        <p className="quiet-note">Nobody can join a room after it ends.</p>
        <a className="action-button action-secondary" href="/">Start another room</a>
      </main>
    );
  }

  const roster = data.roster ?? [];
  const queue = data.queue ?? [];

  return (
    <main className="room-shell">
      <header className="room-header">
        <div>
          <p className="eyebrow">HOST SCREEN</p>
          <h1>Room {code}</h1>
          <p className="quiet-note">Scan the code or share the link below</p>
        </div>
        {data.room?.guestControlLocked === true ? (
          <p className="lock-banner" role="status">Guest controls are locked</p>
        ) : null}
      </header>

      <section className="panel join-panel" aria-labelledby="join-heading">
        <h2 id="join-heading">Invite your singers</h2>
        <div className="join-grid">
          <div className="qr-frame" aria-label="QR code for joining this room" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div>
            <p className="join-code">{code}</p>
            <p className="join-url">{joinUrl}</p>
            <p className="quiet-note">Guests scan the code or open the link on any phone. No account is needed.</p>
          </div>
        </div>
      </section>

      <YouTubePlayer
        playback={data.playback}
        onEnded={() => { void runPlayback('next'); }}
        onProgress={(seconds) => {
          void reportPlaybackPosition(api, roomId, seconds).catch(() => undefined);
        }}
        playerFactory={youtubePlayerFactory}
      />

      <section className="panel" aria-labelledby="playback-heading">
        <h2 id="playback-heading">Playback</h2>
        <PlaybackControls
          roomId={roomId}
          playback={data.playback}
          onChanged={() => { void refresh(); }}
        />
      </section>

      <ParticipantRoster roster={roster} />

      <section className="panel" aria-labelledby="host-add-heading">
        <h2 id="host-add-heading">Add a song as host</h2>
        <SongSearch roomId={roomId} onAdded={() => { void refresh(); }} />
        <PasteSongForm roomId={roomId} onAdded={() => { void refresh(); }} />
      </section>

      <QueueList
        queue={queue}
        onRemove={(songId) => {
          void removeSong(api, roomId, songId).then(() => refresh()).catch(() => undefined);
        }}
      />

      <section className="panel" aria-labelledby="controls-heading">
        <h2 id="controls-heading">Host controls</h2>
        <div className="control-row">
          <button className="action-button action-secondary" type="button" onClick={() => void runCommand('lock')}>
            Lock guest controls
          </button>
          <button className="action-button action-secondary" type="button" onClick={() => void runCommand('unlock')}>
            Unlock guest controls
          </button>
          <button className="action-button action-secondary" type="button" onClick={() => void runCommand('clear_queue')}>
            Clear queue
          </button>
          <button className="action-button action-primary" type="button" onClick={() => void runCommand('end')}>
            End room
          </button>
        </div>
        {commandError !== null ? <p className="form-error" role="alert">{commandError}</p> : null}
      </section>
    </main>
  );
}