import type { ReactNode } from 'react';
import { ArrowDownIcon } from '@phosphor-icons/react/dist/csr/ArrowDown';
import { ArrowUpIcon } from '@phosphor-icons/react/dist/csr/ArrowUp';
import { MusicNotesIcon } from '@phosphor-icons/react/dist/csr/MusicNotes';
import { ThumbsUpIcon } from '@phosphor-icons/react/dist/csr/ThumbsUp';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { QueueEntry } from '../rooms/useRoomData';
import { formatTime } from '../../lib/format';
import { SongArtwork } from '../../ui';

export type QueueListVariant = 'table' | 'side' | 'guest' | 'stage';

type UpNextListProps = {
  queue: QueueEntry[];
  variant?: QueueListVariant;
  onRemove?: (songId: string) => void;
  onReorder?: (songId: string, direction: 'up' | 'down') => void;
  onVote?: (songId: string) => void;
  voteLocked?: boolean;
  votingSongId?: string | null;
  busySongId?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  listId?: string;
  viewerMemberId?: string;
  className?: string;
};

function isPlaying(song: QueueEntry): boolean {
  return song.status === 'playing';
}

function stagger(index: number): { animationDelay: string } {
  return { animationDelay: Math.min(index, 10) * 30 + 'ms' };
}

/**
 * Second a song, or take the second back.
 *
 * The count is the only text the row carries; the pressed state comes from the
 * read rather than from the click, so a vote a member cast on another device
 * shows here too.
 */
function VoteButton({ song, busy, locked, onVote, compact = false }: {
  song: QueueEntry;
  busy: boolean;
  locked: boolean;
  onVote: (songId: string) => void;
  compact?: boolean;
}) {
  const voted = song.votedByViewer === true;
  return (
    <button
      type="button"
      onClick={() => onVote(song.songId)}
      disabled={busy || locked}
      aria-pressed={voted}
      aria-label={(voted ? 'Take back your vote for ' : 'Second ') + song.title
        + ', ' + song.voteCount + (song.voteCount === 1 ? ' vote' : ' votes')}
      className={[
        'flex min-w-11 shrink-0 items-center justify-center gap-1 rounded-full border transition-[background-color,border-color,color,transform,scale] active:scale-95',
        compact ? 'min-h-11 px-2 text-[0.625rem]' : 'min-h-11 px-3 text-[0.6875rem]',
        voted
          ? 'border-signal/40 bg-signal-soft text-signal'
          : 'border-line text-ink-2 hover:bg-surface-2 hover:text-ink',
      ].join(' ')}
    >
      <ThumbsUpIcon size={compact ? 13 : 15} weight={voted ? 'fill' : 'duotone'} aria-hidden="true" />
      <span className="tabular font-semibold">{song.voteCount}</span>
    </button>
  );
}

export function UpNextList({
  queue,
  variant = 'guest',
  onRemove,
  onReorder,
  onVote,
  voteLocked = false,
  votingSongId = null,
  busySongId = null,
  emptyTitle = 'Nothing in the queue yet.',
  emptyDescription = 'Search for a song and add it to the room.',
  emptyAction,
  listId,
  viewerMemberId,
  className = '',
}: UpNextListProps) {
  const upNext = queue.filter((song) => !isPlaying(song));

  if (upNext.length === 0) {
    return (
      <div className={['rounded-panel border border-dashed border-line bg-surface/50 px-5 py-8 text-center', className].join(' ')}>
        <span aria-hidden="true" className="mx-auto grid size-10 place-items-center rounded-full bg-surface-2 text-ink-2">
          <MusicNotesIcon size={18} weight="duotone" />
        </span>
        <p className="mt-3 font-display text-[1.125rem] font-bold tracking-[-0.01em] text-ink">{emptyTitle}</p>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-[0.75rem] leading-[1.6] text-ink-2">{emptyDescription}</p>
        {emptyAction === undefined ? null : <div className="mt-4 flex justify-center">{emptyAction}</div>}
      </div>
    );
  }

  if (variant === 'side' || variant === 'stage') {
    return (
      <ol id={listId} className={['flex flex-col gap-2', className].join(' ')} aria-label="Up next">
        {upNext.map((song, index) => {
          const next = index === 0;
          return (
            <li
              key={song.songId}
              className={[
                'stagger-in flex items-center gap-3 rounded-media border px-3 py-2.5',
                next ? 'border-signal/35 bg-signal-soft' : 'border-line bg-surface-2/60',
              ].join(' ')}
              style={stagger(index)}
            >
              <SongArtwork src={song.thumbnailUrl} className="h-10 w-10" iconSize={15} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[0.8125rem] font-bold leading-[1.3] text-ink">{song.title}</p>
                <p className="mt-0.5 truncate text-[0.625rem] text-ink-2">
                  {song.channelTitle ?? 'YouTube'}
                  {song.durationSeconds === null ? '' : ' · ' + formatTime(song.durationSeconds)}
                </p>
              </div>
              {next ? (
                <span className="rounded-badge bg-signal px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-[0.06em] text-signal-ink">Next</span>
              ) : (
                <span className="text-[0.625rem] tabular text-ink-3">{index + 1}</span>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  if (variant === 'table') {
    return (
      <ol id={listId} className={['divide-y divide-line', className].join(' ')} aria-label="Up next">
        {upNext.map((song, index) => {
          const busy = busySongId === song.songId;
          return (
            <li key={song.songId} className="stagger-in flex items-center gap-3 py-3 first:pt-0 last:pb-0" style={stagger(index)}>
              <span className="w-6 shrink-0 font-display text-[0.8125rem] tabular text-signal/80">
                {String(index + 1).padStart(2, '0')}
              </span>
              <SongArtwork src={song.thumbnailUrl} className="h-11 w-11" iconSize={16} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-semibold leading-[1.35] text-ink">{song.title}</p>
                <p className="mt-0.5 truncate text-[0.6875rem] text-ink-2">{song.channelTitle ?? 'YouTube'}</p>
                <p className="mt-0.5 truncate text-[0.625rem] text-ink-3">Added by {song.addedBy}</p>
              </div>
              <span className="hidden shrink-0 text-[0.6875rem] tabular text-ink-2 sm:block">
                {song.durationSeconds === null ? '—' : formatTime(song.durationSeconds)}
              </span>
              {onReorder === undefined ? null : (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onReorder(song.songId, 'up')}
                    disabled={busy || index === 0}
                    aria-label={'Move ' + song.title + ' up'}
                    className="grid size-11 place-items-center rounded-full text-ink-2 transition-[background-color,color,transform,scale] active:scale-95 hover:bg-surface-2 hover:text-ink disabled:opacity-25"
                  >
                    <ArrowUpIcon size={14} weight="bold" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorder(song.songId, 'down')}
                    disabled={busy || index === upNext.length - 1}
                    aria-label={'Move ' + song.title + ' down'}
                    className="grid size-11 place-items-center rounded-full text-ink-2 transition-[background-color,color,transform,scale] active:scale-95 hover:bg-surface-2 hover:text-ink disabled:opacity-25"
                  >
                    <ArrowDownIcon size={14} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              )}
              {onVote === undefined ? null : (
                <VoteButton song={song} busy={busy || votingSongId !== null} locked={false} onVote={onVote} compact />
              )}
              {onRemove === undefined ? null : (
                <button
                  type="button"
                  onClick={() => onRemove(song.songId)}
                  disabled={busy}
                  aria-label={'Remove ' + song.title}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-ink-3 transition-[background-color,color,transform,scale] active:scale-95 hover:bg-danger-soft hover:text-danger disabled:opacity-30"
                >
                  <XIcon size={14} weight="bold" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol id={listId} className={['divide-y divide-line', className].join(' ')} aria-label="Up next">
      {upNext.map((song, index) => {
        const next = index === 0;
        return (
          <li key={song.songId} className="stagger-in flex items-center gap-3 py-3 first:pt-0 last:pb-0" style={stagger(index)}>
            <span className="w-5 shrink-0 text-[0.8125rem] tabular text-signal/80">{String(index + 1).padStart(2, '0')}</span>
            <SongArtwork src={song.thumbnailUrl} className="h-[2.875rem] w-[2.875rem]" iconSize={15} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-semibold leading-[1.35] text-ink">{song.title}</p>
              <p className="mt-0.5 truncate text-[0.625rem] text-ink-2">{song.channelTitle ?? 'YouTube'}</p>
              <p className={['mt-0.5 truncate text-[0.5625rem]', song.memberId === viewerMemberId ? 'text-signal' : 'text-ink-3'].join(' ')}>
                Added by {song.addedBy}
                {song.memberId === viewerMemberId ? ' (you)' : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[0.625rem] tabular text-ink-2">
                {song.durationSeconds === null ? '' : formatTime(song.durationSeconds)}
              </span>
              {next ? (
                <span className="rounded-badge bg-signal-soft px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-[0.06em] text-signal">Next</span>
              ) : null}
            </div>
            {onVote === undefined ? null : (
              <VoteButton song={song} busy={votingSongId !== null} locked={voteLocked} onVote={onVote} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function PlayingBars({ active = true }: { active?: boolean }) {
  return (
    <span aria-hidden="true" className="flex h-4 items-end gap-[2px]">
      {[0.55, 0.9, 0.7, 1, 0.45].map((scale, index) => (
        <span
          key={index}
          className="w-[2px] origin-bottom rounded-full bg-signal"
          style={{
            height: '100%',
            transform: 'scaleY(' + scale + ')',
            animation: active ? 'equalizer 900ms ease-in-out ' + (index * 90) + 'ms infinite alternate' : undefined,
            opacity: active ? 1 : 0.4,
          }}
        />
      ))}
    </span>
  );
}
