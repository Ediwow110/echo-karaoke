import { useParams } from 'react-router-dom';
import { useRoomData } from '../features/rooms/useRoomData';
import ParticipantRoster from '../features/rooms/ParticipantRoster';
import QueueList from '../features/queue/QueueList';

export default function GuestRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const { data, error, loading } = useRoomData(roomId, 'guest');

  if (loading) {
    return <main className="room-shell"><p role="status">Loading the room</p></main>;
  }

  if (error !== null) {
    return (
      <main className="room-shell">
        <h1>Room unavailable</h1>
        <p className="form-error" role="alert">{error}</p>
        <a className="action-button action-secondary" href="/">Back to start</a>
      </main>
    );
  }

  if (data === null || data.status === 'ended') {
    return (
      <main className="room-shell">
        <h1>This room has ended</h1>
        <p className="quiet-note">The host closed the session. Thanks for singing.</p>
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
          <p className="eyebrow">REMOTE</p>
          <h1>{data.viewer?.displayName ?? 'Guest'}</h1>
          <p className="quiet-note">Room code {data.room?.code ?? ''}</p>
        </div>
        {data.room?.guestControlLocked === true ? (
          <p className="lock-banner" role="status">Guest controls are locked by the host</p>
        ) : null}
      </header>

      <ParticipantRoster roster={roster} />
      <QueueList queue={queue} />

      <section className="panel" aria-labelledby="remote-heading">
        <h2 id="remote-heading">Your remote</h2>
        <p className="empty-state">
          Song search and playback controls arrive with the next task. For now this page shows the live queue and who is in the room.
        </p>
      </section>
    </main>
  );
}
