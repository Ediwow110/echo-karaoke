import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward';
import { SpeakerHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerHigh';
import type { QueueEntry } from '../rooms/useRoomData';
import type { PlaybackState } from './playbackApi';
import { useHostPlayer } from './useHostPlayer';
import { formatTime } from '../../lib/format';
import { isFavorite, subscribeLibrary, toggleFavorite } from '../library/libraryStore';
import { Chip, IconButton, SongArtwork } from '../../ui';

type Props = {
  roomId: string;
  nowPlaying: QueueEntry | null;
  playback: PlaybackState | undefined;
  onTogglePlay: () => Promise<void>;
  onNext: () => Promise<unknown>;
};

export default function PlayerDock({ roomId, nowPlaying, playback, onTogglePlay, onNext }: Props) {
  const { currentTime, duration, volume, setVolume, seekBy, needsTap, playerError, advanceStalled, requestPlay } = useHostPlayer();
  const [busy, setBusy] = useState<'play' | 'next' | null>(null);
  const videoId = nowPlaying?.videoId ?? null;
  const [saved, setSaved] = useState(() => videoId !== null && isFavorite(videoId));

  useEffect(() => {
    const sync = (): void => setSaved(videoId !== null && isFavorite(videoId));
    sync();
    return subscribeLibrary(sync);
  }, [videoId]);

  const playing = playback?.isPlaying === true;
  const durationSafe = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const currentSafe = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const progress = durationSafe > 0 ? Math.min(100, (currentSafe / durationSafe) * 100) : 0;
  const canControl = nowPlaying !== null;
  const volumeSafe = Number.isFinite(volume) ? volume : 100;

  async function toggle(): Promise<void> {
    setBusy('play');
    try {
      await onTogglePlay();
    } finally {
      setBusy(null);
    }
  }

  async function next(): Promise<void> {
    setBusy('next');
    try {
      await onNext();
    } finally {
      setBusy(null);
    }
  }

  function favorite(): void {
    if (nowPlaying === null) return;
    toggleFavorite(nowPlaying);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-graphite-deep/95 backdrop-blur lg:left-[232px]">
      <div className="mx-auto max-w-[1240px] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <SongArtwork
            src={nowPlaying?.thumbnailUrl}
            className="h-12 w-12 shrink-0"
            iconSize={17}
          />
          <div className="min-w-0 flex-1">
            <p className={['truncate text-[0.8125rem] font-semibold leading-[1.3]', nowPlaying === null ? 'text-ink-2' : 'text-ink'].join(' ')}>
              {nowPlaying?.title ?? 'Nothing is playing yet.'}
            </p>
            <p className="mt-0.5 truncate text-[0.625rem] text-ink-2">
              {nowPlaying === null
                ? 'Add a song, then start playback on this host screen.'
                : (nowPlaying.channelTitle ?? 'YouTube') + ' · ' + formatTime(currentTime) + ' / ' + (duration > 0 ? formatTime(duration) : '—:—')}
            </p>
          </div>

          <div className="hidden w-[26%] max-w-[16rem] items-center gap-2 sm:flex">
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(durationSafe))}
              value={Math.min(Math.floor(currentSafe), Math.max(1, Math.floor(durationSafe)))}
              onChange={(event) => seekBy(Number(event.target.value) - currentSafe)}
              aria-label="Playback position"
              disabled={!canControl || durationSafe <= 0}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-signal disabled:cursor-default"
              style={{ background: 'linear-gradient(to right, var(--color-signal) ' + progress + '%, var(--color-line) ' + progress + '%)' }}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <div className="hidden sm:flex">
              <IconButton
                icon={<ArrowCounterClockwiseIcon size={17} weight="regular" />}
                label="Back 10 seconds"
                tone="ghost"
                size="sm"
                onClick={() => seekBy(-10)}
                disabled={!canControl}
              />
            </div>
            {needsTap && playerError === null ? (
              <button
                type="button"
                onClick={requestPlay}
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-signal-fill px-4 text-[0.75rem] font-semibold text-signal-ink hover:bg-signal-fill-hover"
              >
                <PlayIcon size={15} weight="fill" aria-hidden="true" />
                Start playback
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void toggle()}
                disabled={!canControl || busy !== null || playerError !== null}
                aria-label={playing ? 'Pause' : 'Play'}
                className="grid size-11 place-items-center rounded-full bg-signal-fill text-signal-ink transition-colors hover:bg-signal-fill-hover disabled:pointer-events-none disabled:bg-surface-2 disabled:text-ink-3 disabled:opacity-70"
              >
                {busy === 'play' ? (
                  <ArrowClockwiseIcon size={18} className="animate-spin" aria-hidden="true" />
                ) : playing ? (
                  <PauseIcon size={18} weight="fill" aria-hidden="true" />
                ) : (
                  <PlayIcon size={18} weight="fill" aria-hidden="true" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => void next()}
              disabled={!canControl || busy !== null}
              aria-label="Skip song"
              className="grid size-10 place-items-center rounded-full border border-line bg-surface-2 text-ink transition-colors hover:border-line-strong hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-35"
            >
              {busy === 'next' ? <ArrowClockwiseIcon size={16} className="animate-spin" aria-hidden="true" /> : <SkipForwardIcon size={16} weight="fill" aria-hidden="true" />}
            </button>
            <div className="hidden sm:flex">
              <Link
                to={'/room/' + roomId + '/host/stage'}
                aria-label="Open stage"
                className="tooltip inline-flex" data-tooltip="Open stage"
              >
                <span className="grid size-8 place-items-center rounded-full border border-transparent text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                  <ArrowsOutIcon size={17} weight="regular" aria-hidden="true" />
                </span>
              </Link>
            </div>
          </div>

          <div className="hidden items-center gap-3 lg:flex">
            {playerError !== null ? (
              <Chip tone="danger">Video unavailable</Chip>
            ) : (
              <Chip tone={advanceStalled ? 'gold' : needsTap ? 'gold' : playing ? 'live' : 'default'}>
                {advanceStalled ? 'Playback stalled' : needsTap ? 'Needs host click' : playing ? 'Playing' : 'Paused'}
              </Chip>
            )}
            <div className="hidden items-center gap-2 xl:flex">
              <SpeakerHighIcon size={15} className="text-ink-2" aria-hidden="true" />
              <input
                type="range"
                min={0}
                max={100}
                value={volumeSafe}
                onChange={(event) => setVolume(Number(event.target.value))}
                aria-label="Volume"
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-line accent-signal"
              />
            </div>
            <Link
              to={'/room/' + roomId + '/host/stage'}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-media border border-line bg-surface px-2.5 text-[0.6875rem] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
            >
              Stage
            </Link>
          </div>

          <div className="hidden shrink-0 items-center gap-1 lg:flex">
            <button
              type="button"
              onClick={favorite}
              disabled={nowPlaying === null}
              aria-label={saved ? 'Remove from favorites' : 'Save to favorites'}
              aria-pressed={saved}
              className={['grid size-8 place-items-center rounded-full transition-colors', saved ? 'text-signal' : 'text-ink-2 hover:text-ink'].join(' ')}
            >
              <HeartIcon size={17} weight={saved ? 'fill' : 'regular'} aria-hidden="true" />
            </button>
            <span className="text-[0.625rem] text-ink-3">Host controls</span>
          </div>
        </div>
      </div>
    </div>
  );
}
