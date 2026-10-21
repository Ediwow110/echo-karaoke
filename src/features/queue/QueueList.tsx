import { MusicNoteIcon } from '@phosphor-icons/react';
import type { QueueEntry } from '../rooms/useRoomData';
import { QUEUE_ELEMENT_ID } from './queueAnchor';
import { Panel, QueueRow } from '../../ui';

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
      <Panel title="Up next" icon={<MusicNoteIcon size={18} weight="duotone" />}>
        <p id={QUEUE_ELEMENT_ID} className="text-[0.875rem] text-ink-3">
          No songs yet. Search for a track or paste a YouTube link to start the queue.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Up next" icon={<MusicNoteIcon size={18} weight="duotone" />}>
      <ol id={QUEUE_ELEMENT_ID} className="flex flex-col gap-2">
        {queue.map((song) => (
          <QueueRow
            key={song.songId}
            song={{
              songId: song.songId,
              title: song.title,
              channelTitle: song.channelTitle,
              thumbnailUrl: song.thumbnailUrl,
              position: song.position,
              addedBy: song.addedBy,
              voteCount: song.voteCount,
            }}
            onVote={onVote}
            votingDisabled={votingDisabled}
            onRemove={onRemove}
            canRemove={canRemove === undefined ? true : canRemove(song)}
            removingDisabled={removingDisabled}
          />
        ))}
      </ol>
    </Panel>
  );
}
