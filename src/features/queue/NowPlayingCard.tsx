import type { ReactNode } from 'react';
import { MonitorPlayIcon } from '@phosphor-icons/react/dist/csr/MonitorPlay';
import type { QueueEntry } from '../rooms/useRoomData';
import type { PlaybackState } from '../playback/playbackApi';
import { usePlaybackProgress } from '../playback/usePlaybackProgress';
import { formatTime } from '../../lib/format';
import { Chip, SongArtwork } from '../../ui';
import { PlayingBars } from './QueueRows';

type Props = {
  song: QueueEntry | null;
  playback?: PlaybackState;
  variant?: 'guest' | 'host' | 'side';
  currentTime?: number;
  duration?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  showHeader?: boolean;
  className?: string;
};

export default function NowPlayingCard({
  song,
  playback,
  variant = 'guest',
  currentTime,
  duration,
  emptyTitle = 'The stage is quiet.',
  emptyDescription = 'Add a song to start the night.',
  emptyAction,
  showHeader = true,
  className = '',
}: Props) {
  const estimated = usePlaybackProgress(playback);
  const rawElapsed = currentTime ?? estimated;
  const total = duration ?? playback?.durationSeconds ?? song?.durationSeconds ?? 0;
  const elapsed = total > 0 ? Math.min(rawElapsed, total) : rawElapsed;
  const playing = playback?.isPlaying === true;

  if (song === null) {
    return (
      <div className={['relative overflow-hidden rounded-panel border border-line bg-surface', className].join(' ')}>
        <img
          src="/images/stage-spotlight.jpg"
          alt=""
          className="stage-pan absolute inset-0 h-full w-full object-cover opacity-45"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0 stage-sheen" aria-hidden="true" />
        <div className="stage-smoke absolute inset-0" aria-hidden="true" />
        <div className="relative px-5 py-7">
          <p className="eyebrow text-gold">Now playing</p>
          <h3 className="mt-2 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-ink">{emptyTitle}</h3>
          <p className="mt-1.5 max-w-[36ch] text-[0.75rem] leading-[1.6] text-ink-2">{emptyDescription}</p>
          {emptyAction === undefined ? null : <div className="mt-4">{emptyAction}</div>}
        </div>
      </div>
    );
  }

  const progress = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;

  if (variant === 'side') {
    return (
      <div className={['overflow-hidden rounded-panel border border-line bg-surface', className].join(' ')}>
        <div className="relative">
          <SongArtwork src={song.thumbnailUrl} className="aspect-[16/10] w-full" rounded="none" iconSize={28} />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgba(16,13,24,0.92)_100%)]" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
            <p className="eyebrow text-gold">Now playing</p>
            <PlayingBars active={playing} />
          </div>
        </div>
        <div className="px-4 pb-4 pt-3">
          <h3 className="truncate font-display text-[1.3rem] font-bold tracking-[-0.02em] text-ink">{song.title}</h3>
          <p className="mt-0.5 truncate text-[0.6875rem] text-ink-2">
            {song.channelTitle ?? 'YouTube'}
            {song.durationSeconds === null ? '' : ' · ' + formatTime(song.durationSeconds)}
          </p>
          <p className="mt-1 truncate text-[0.625rem] text-ink-3">Added by {song.addedBy}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Chip tone="default">
              <MonitorPlayIcon size={11} aria-hidden="true" />
              Host screen
            </Chip>
            <span className="text-[0.625rem] tabular text-ink-2">{formatTime(elapsed)}</span>
          </div>
          {total > 0 ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-signal" style={{ width: progress + '%' }} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const host = variant === 'host';

  return (
    <div className={[
      'relative overflow-hidden rounded-panel border border-line bg-surface',
      host ? '' : 'border-signal/20',
      className,
    ].join(' ')}>
      {showHeader ? (
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
          <div className="flex items-center gap-2">
            <p className="eyebrow text-gold">Now playing</p>
            <PlayingBars active={playing} />
          </div>
          <Chip tone="default">
            <MonitorPlayIcon size={11} aria-hidden="true" />
            Host screen
          </Chip>
        </div>
      ) : null}
      <div className={['flex items-start gap-3 px-4 pb-4', showHeader ? 'pt-3' : 'pt-4'].join(' ')}>
        <SongArtwork
          src={song.thumbnailUrl}
          className={host ? 'h-16 w-16' : 'h-[4.1rem] w-[4.1rem]'}
          iconSize={22}
        />
        <div className="min-w-0 flex-1">
          <h3 className={['font-display font-bold tracking-[-0.02em] text-ink', host ? 'truncate text-[1.25rem]' : 'line-clamp-2 text-[1.3rem] leading-[1.18]'].join(' ')}>
            {song.title}
          </h3>
          <p className="mt-0.5 truncate text-[0.6875rem] text-ink-2">
            {song.channelTitle ?? 'YouTube'}
            {song.durationSeconds === null ? '' : ' · ' + formatTime(song.durationSeconds)}
          </p>
          <p className="mt-1 truncate text-[0.625rem] text-ink-3">Added by {song.addedBy}</p>
        </div>
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between text-[0.625rem] tabular text-ink-2">
          <span>{formatTime(elapsed)}</span>
          <span>{total > 0 ? formatTime(total) : ''}</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-signal transition-[width] duration-500" style={{ width: progress + '%' }} />
        </div>
      </div>
    </div>
  );
}
