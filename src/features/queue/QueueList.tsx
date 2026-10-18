import type { QueueEntry } from '../rooms/useRoomData';

type Props = {
  queue: QueueEntry[];
  onVote?: (songId: string) => void;
  votingDisabled?: boolean;
  onRemove?: (songId: string) => void;
  canRemove?: (song: QueueEntry) => boolean;
  removingDisabled?: boolean;
};

export default function QueueList({
  queue,
  onVote,
  votingDisabled = false,
  onRemove,
  canRemove,
  removingDisabled = false,
}: Props) {
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
            {onRemove !== undefined && (canRemove === undefined || canRemove(song)) ? (
              <button
                className="remove-button"
                type="button"
                onClick={() => onRemove(song.songId)}
                disabled={removingDisabled}
                aria-label={'Remove ' + song.title}
              >
                Remove
              </button>
            ) : null}
            {onVote !== undefined ? (
              <button
                className="vote-button"
                type="button"
                onClick={() => onVote(song.songId)}
                disabled={votingDisabled}
                aria-label={'Vote for ' + song.title + ', ' + song.voteCount + ' votes'}
              >
                <span aria-hidden="true">▲</span>
                <span className="vote-count">{song.voteCount}</span>
              </button>
            ) : (
              <span className="queue-votes" aria-label={song.voteCount + ' votes'}>{song.voteCount}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}