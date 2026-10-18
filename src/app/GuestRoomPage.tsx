import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useRoomData } from '../features/rooms/useRoomData';
import ParticipantRoster from '../features/rooms/ParticipantRoster';
import QueueList from '../features/queue/QueueList';
import PasteSongForm from '../features/queue/PasteSongForm';
import SongSearch from '../features/queue/SongSearch';
import PlaybackControls from '../features/playback/PlaybackControls';
import { toggleVote } from '../features/queue/voteApi';
import { removeSong } from '../features/queue/queueApi';
import { useRoomApi } from './RoomApiProvider';

export default function GuestRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const api = useRoomApi();
  const { data, error, loading, refresh } = useRoomData(roomId, 'guest');
  const [voteError, setVoteError] = useState<string | null>(null);

  async function handleRemove(songId: string): Promise<void> {
    setVoteError(null);
    try {
      await removeSong(api, roomId, songId);
      await refresh();
    } catch (caught) {
      setVoteError(caught instanceof Error ? caught.message : 'That song could not be removed.');
    }
  }

  async function handleVote(songId: string): Promise<void> {
    setVoteError(null);
    try {
      await toggleVote(api, roomId, songId);
      await refresh();
    } catch (caught) {
      setVoteError(caught instanceof Error ? caught.message : 'That vote failed.');
    }
  }

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
  const locked = data.room?.guestControlLocked === true;

  return (
    <main className="room-shell">
      <header className="room-header">
        <div>
          <p className="eyebrow">REMOTE</p>
          <h1>{data.viewer?.displayName ?? 'Guest'}</h1>
          <p className="quiet-note">Room code {data.room?.code ?? ''}</p>
        </div>
        {locked ? (
          <p className="lock-banner" role="status">Guest controls are locked by the host</p>
        ) : null}
      </header>

      <div className="room-workspace">
        <div className="room-main">
          <section className="panel" aria-labelledby="add-heading">
            <h2 id="add-heading">Add a song</h2>
            <SongSearch roomId={roomId} disabled={locked} onAdded={() => { void refresh(); }} />
            <PasteSongForm roomId={roomId} disabled={locked} onAdded={() => { void refresh(); }} />
          </section>

          <QueueList
            queue={queue}
            onVote={(songId) => { void handleVote(songId); }}
            votingDisabled={locked}
            onRemove={(songId) => { void handleRemove(songId); }}
            canRemove={(song) => song.memberId === data.viewer?.memberId}
            removingDisabled={locked}
          />
          {voteError !== null ? <p className="form-error" role="alert">{voteError}</p> : null}
        </div>

        <aside className="room-aside">
          <ParticipantRoster roster={roster} />

          <section className="panel" aria-labelledby="remote-heading">
            <h2 id="remote-heading">Your remote</h2>
            <PlaybackControls
              roomId={roomId}
              playback={data.playback}
              disabled={locked}
              onChanged={() => { void refresh(); }}
            />
          </section>
        </aside>
      </div>
    </main>
  );
}
