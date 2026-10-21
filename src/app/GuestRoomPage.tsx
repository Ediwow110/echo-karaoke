import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MagnifyingGlassIcon, MusicNoteIcon, SignOutIcon } from '@phosphor-icons/react';
import { useRoomData } from '../features/rooms/useRoomData';
import ParticipantRoster from '../features/rooms/ParticipantRoster';
import QueueList from '../features/queue/QueueList';
import PasteSongForm from '../features/queue/PasteSongForm';
import PopularSongs from '../features/queue/PopularSongs';
import SongSearch from '../features/queue/SongSearch';
import PlaybackControls from '../features/playback/PlaybackControls';
import { toggleVote } from '../features/queue/voteApi';
import { removeSong } from '../features/queue/queueApi';
import { clearGuestToken } from '../features/rooms/tokenStore';
import { useRoomApi } from './RoomApiProvider';
import { Chip, IconButton, LockBanner, Panel } from '../ui';

export default function GuestRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const api = useRoomApi();
  const navigate = useNavigate();
  const { data, error, loading, refresh } = useRoomData(roomId, 'guest');
  const [voteError, setVoteError] = useState<string | null>(null);

  function handleLeave(): void {
    clearGuestToken(roomId);
    navigate('/');
  }

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
    return (
      <main className="min-h-dvh bg-graphite px-4 py-6 text-ink">
        <div className="skeleton h-14 w-full rounded-panel" />
        <div className="skeleton mt-4 h-32 w-full rounded-panel" />
        <div className="skeleton mt-4 h-64 w-full rounded-panel" />
      </main>
    );
  }

  if (error !== null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Room unavailable</h1>
          <p role="alert" className="mt-3 rounded-media border-l-2 border-danger bg-danger/10 px-3.5 py-2.5 text-[0.875rem] text-danger">{error}</p>
          <a href="/" className="mt-4 inline-block text-[0.875rem] text-signal hover:underline">Back to start</a>
        </div>
      </main>
    );
  }

  if (data === null || data.status === 'ended') {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">This room has ended</h1>
          <p className="mt-2 text-[0.875rem] text-ink-3">The host closed the session. Thanks for singing.</p>
          <a href="/" className="mt-4 inline-block text-[0.875rem] text-signal hover:underline">Start another room</a>
        </div>
      </main>
    );
  }

  const roster = data.roster ?? [];
  const queue = data.queue ?? [];
  const locked = data.room?.guestControlLocked === true;
  const nowPlaying = queue.find((song) => song.status === 'playing');

  return (
    <main className="min-h-dvh bg-graphite pb-32 text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-graphite/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <MusicNoteIcon size={22} weight="duotone" className="shrink-0 text-signal" aria-hidden="true" />
            <h1 className="truncate font-display text-lg font-semibold tracking-tight">
              {data.viewer?.displayName ?? 'Guest'}
            </h1>
          </div>
          <Chip>{data.room?.code ?? ''}</Chip>
          <IconButton icon={<SignOutIcon size={18} weight="regular" />} label="Leave room" placement="bottom" onClick={handleLeave} />
        </div>
        {locked ? <LockBanner text="Guest controls are locked by the host" /> : null}
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {nowPlaying === undefined ? null : (
            <Panel title="Now playing" icon={<MusicNoteIcon size={18} weight="duotone" />}>
              <div className="flex items-center gap-3">
                {nowPlaying.thumbnailUrl !== null ? (
                  <img className="h-14 w-24 shrink-0 rounded-media object-cover" src={nowPlaying.thumbnailUrl} alt="" width={96} height={56} loading="lazy" />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-[0.9375rem] font-semibold">{nowPlaying.title}</p>
                  <p className="truncate text-[0.8125rem] text-ink-3">{nowPlaying.channelTitle ?? 'YouTube'}</p>
                </div>
                <span aria-hidden="true" className="ml-auto flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-live">
                  <span className="size-2 animate-presence-pulse rounded-full bg-live" />
                  Live
                </span>
              </div>
            </Panel>
          )}

          <Panel title="Add a song" icon={<MagnifyingGlassIcon size={18} weight="duotone" />}>
            <PopularSongs roomId={roomId} onAdded={() => { void refresh(); }} />
            <div className="mt-4 border-t border-line pt-4">
              <SongSearch roomId={roomId} disabled={locked} onAdded={() => { void refresh(); }} />
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <PasteSongForm roomId={roomId} disabled={locked} onAdded={() => { void refresh(); }} />
            </div>
          </Panel>

          <QueueList
            queue={queue}
            onVote={(songId) => { void handleVote(songId); }}
            votingDisabled={locked}
            onRemove={(songId) => { void handleRemove(songId); }}
            canRemove={(song) => song.memberId === data.viewer?.memberId}
            removingDisabled={locked}
          />
          {voteError === null ? null : (
            <p role="alert" className="rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{voteError}</p>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <ParticipantRoster roster={roster} />
        </aside>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="pointer-events-auto mx-auto flex w-fit items-center gap-3 rounded-panel border border-line bg-graphite/95 px-4 py-2 backdrop-blur">
          <PlaybackControls
            roomId={roomId}
            playback={data.playback}
            disabled={locked}
            shape="dock"
            onChanged={() => { void refresh(); }}
          />
        </div>
      </div>
    </main>
  );
}
