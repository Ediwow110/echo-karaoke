import type { QueueEntry } from '../rooms/useRoomData';

export default function QueueList({ queue }: { queue: QueueEntry[] }) {
  if (queue.length === 0) {
    return (
      <section className="panel" aria-labelledby="queue-heading">
        <h2 id="queue-heading">Up next</h2>
        <p className="empty-state">No songs yet. Search for a track or paste a YouTube link to start the queue.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="queue-heading">
      <h2 id="queue-heading">Up next</h2>
      <ol className="queue">
        {queue.map((song) => (
          <li key={song.songId} className="queue-entry">
            <span className="queue-position">{song.position}</span>
            {song.thumbnailUrl !== null ? (
              <img className="queue-thumb" src={song.thumbnailUrl} alt="" width={72} height={40} loading="lazy" />
            ) : null}
            <span className="queue-copy">
              <span className="queue-title">{song.title}</span>
              <span className="queue-meta">{song.channelTitle ?? 'YouTube'} · added by {song.addedBy}</span>
            </span>
            <span className="queue-votes" aria-label={song.voteCount + ' votes'}>{song.voteCount}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
