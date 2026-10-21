import { ThumbsUpIcon, TrashSimpleIcon } from '@phosphor-icons/react';

export type QueueRowData = {
  songId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  position: number;
  addedBy: string;
  voteCount: number;
};

export type QueueRowProps = {
  song: QueueRowData;
  onVote?: (songId: string) => void;
  votingDisabled?: boolean;
  onRemove?: (songId: string) => void;
  canRemove?: boolean;
  removingDisabled?: boolean;
};

export default function QueueRow({
  song,
  onVote,
  votingDisabled = false,
  onRemove,
  canRemove = false,
  removingDisabled = false,
}: QueueRowProps) {
  return (
    <li className="flex items-center gap-2.5 rounded-panel border border-line bg-surface-2 p-2.5 transition-colors duration-(--duration-fast) ease-(--ease-console) hover:border-line-strong hover:bg-surface-3 sm:gap-3">
      <span className="w-4 shrink-0 font-mono text-[0.75rem] text-ink-3 sm:w-5">{song.position}</span>
      {song.thumbnailUrl !== null ? (
        <img className="h-8 w-12 shrink-0 rounded-media object-cover sm:h-10 sm:w-[4.5rem]" src={song.thumbnailUrl} alt="" width={72} height={40} loading="lazy" />
      ) : (
        <span aria-hidden="true" className="h-8 w-12 shrink-0 rounded-media bg-surface-3 sm:h-10 sm:w-[4.5rem]" />
      )}
      <span className="min-w-0 flex-1">
        <span className="text-[0.9375rem] font-semibold leading-snug text-ink line-clamp-2 sm:block sm:truncate">{song.title}</span>
        <span className="block truncate text-[0.8125rem] text-ink-3">
          {song.channelTitle ?? 'YouTube'} · added by {song.addedBy}
        </span>
      </span>
      {onRemove !== undefined && canRemove ? (
        <button
          type="button"
          onClick={() => onRemove(song.songId)}
          disabled={removingDisabled}
          aria-label={'Remove ' + song.title}
          className="grid size-9 shrink-0 place-items-center rounded-full text-danger transition-colors duration-(--duration-fast) hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40"
        >
          <TrashSimpleIcon size={18} weight="regular" />
        </button>
      ) : null}
      {onVote !== undefined ? (
        <button
          type="button"
          onClick={() => onVote(song.songId)}
          disabled={votingDisabled}
          aria-label={'Vote for ' + song.title + ', ' + song.voteCount + ' votes'}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-2 font-mono text-[0.8125rem] text-ink-2 transition-colors duration-(--duration-fast) hover:border-signal/50 hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40 sm:px-2.5"
        >
          <ThumbsUpIcon size={16} weight="duotone" />
          <span className="tabular-nums">{song.voteCount}</span>
        </button>
      ) : (
        <span aria-label={song.voteCount + ' votes'} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[0.8125rem] text-ink-3">
          <ThumbsUpIcon size={16} weight="duotone" aria-hidden="true" />
          <span className="tabular-nums">{song.voteCount}</span>
        </span>
      )}
    </li>
  );
}
