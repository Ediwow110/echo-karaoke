import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  CopyIcon,
  LockKeyIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  MicrophoneStageIcon,
  MusicNoteIcon,
  PowerIcon,
  QrCodeIcon,
  SignOutIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useRoomData } from '../features/rooms/useRoomData';
import { useRoomApi } from './RoomApiProvider';
import { sendHostCommand } from '../features/rooms/roomApi';
import { removeSong } from '../features/queue/queueApi';
import { buildJoinUrl } from '../features/rooms/roomUrl';
import ParticipantRoster from '../features/rooms/ParticipantRoster';
import QueueList from '../features/queue/QueueList';
import PasteSongForm from '../features/queue/PasteSongForm';
import PopularSongs from '../features/queue/PopularSongs';
import SongSearch from '../features/queue/SongSearch';
import PlaybackControls from '../features/playback/PlaybackControls';
import YouTubePlayer, { type PlayerViewMode } from '../features/playback/YouTubePlayer';
import PlayerChrome from '../features/playback/PlayerChrome';
import { youtubePlayerFactory } from '../features/playback/youtubeIframe';
import { reportPlaybackPosition, sendPlaybackCommand } from '../features/playback/playbackApi';
import { Button, Chip, IconButton, LockBanner, Panel } from '../ui';

// The code is read aloud, so it groups into blocks of four.
function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

export default function HostRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const api = useRoomApi();
  const navigate = useNavigate();
  const { data, error, loading, refresh } = useRoomData(roomId, 'host');
  const [qrSvg, setQrSvg] = useState<string>('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<PlayerViewMode>('normal');
  const [copied, setCopied] = useState(false);

  const code = data?.room?.code ?? '';
  const joinUrl = code.length > 0 ? buildJoinUrl(window.location.origin, code) : '';

  useEffect(() => {
    if (joinUrl.length === 0) {
      setQrSvg('');
      return;
    }
    let cancelled = false;
    void QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 220 })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  async function runPlayback(action: 'play' | 'pause' | 'next'): Promise<void> {
    try {
      await sendPlaybackCommand(api, roomId, action);
      await refresh();
    } catch {
      // The player retries on the next invalidation.
    }
  }

  async function runCommand(action: 'lock' | 'unlock' | 'end' | 'clear_queue'): Promise<void> {
    setCommandError(null);
    try {
      await sendHostCommand(api, roomId, action);
      await refresh();
    } catch (caught) {
      setCommandError(caught instanceof Error ? caught.message : 'That command failed.');
    }
  }

  async function copyJoinLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
    } catch {
      setCommandError('The link could not be copied. Select it and copy by hand.');
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-graphite px-4 py-6 text-ink">
        <div className="skeleton h-16 w-full rounded-panel" />
        <div className="skeleton mt-4 h-96 w-full rounded-panel" />
      </main>
    );
  }

  if (error !== null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Host controls unavailable</h1>
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
          <p className="mt-2 text-[0.875rem] text-ink-3">Nobody can join a room after it ends.</p>
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
    <main className="min-h-dvh bg-graphite text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-graphite/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-media bg-signal-fill text-white">
              <MicrophoneStageIcon size={20} weight="fill" aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">encore</span>
            <Chip tone="signal">{code}</Chip>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={locked ? <LockSimpleOpenIcon size={16} weight="duotone" /> : <LockSimpleIcon size={16} weight="duotone" />}
              onClick={() => void runCommand(locked ? 'unlock' : 'lock')}
            >
              {locked ? 'Unlock controls' : 'Lock controls'}
            </Button>
            <IconButton icon={<SignOutIcon size={18} weight="regular" />} label="Leave room" placement="bottom" onClick={() => navigate('/')} />
          </div>
        </div>
        {locked ? <LockBanner text="Guest controls are locked" /> : null}
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <YouTubePlayer
            playback={data.playback}
            mode={viewMode}
            onModeChange={setViewMode}
            onEnded={() => { void runPlayback('next'); }}
            onProgress={(seconds) => {
              void reportPlaybackPosition(api, roomId, seconds).catch(() => undefined);
            }}
            playerFactory={youtubePlayerFactory}
            overlay={
              <PlayerChrome
                playing={data.playback?.isPlaying === true}
                title={nowPlaying?.title ?? null}
                channel={nowPlaying?.channelTitle ?? null}
              >
                <PlaybackControls
                  roomId={roomId}
                  playback={data.playback}
                  shape="bar"
                  layout="inline"
                  onChanged={() => { void refresh(); }}
                />
              </PlayerChrome>
            }
          />

          <QueueList
            queue={queue}
            onRemove={(songId) => {
              void removeSong(api, roomId, songId).then(() => refresh()).catch(() => undefined);
            }}
            canRemove={() => true}
          />
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title="Invite your singers" icon={<QrCodeIcon size={18} weight="duotone" />}>
            <p className="font-mono text-xl tracking-[0.12em] text-signal">{groupCode(code)}</p>
            <div className="mt-4 flex items-start gap-4">
              <div className="w-[10rem] shrink-0 rounded-media bg-white p-2.5 [&>svg]:h-auto [&>svg]:w-full" aria-label="QR code for joining this room" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <div className="min-w-0 flex-1">
                <p className="break-all text-[0.8125rem] text-ink-3">{joinUrl}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  icon={<CopyIcon size={16} weight="regular" />}
                  onClick={() => void copyJoinLink()}
                >
                  {copied ? 'Link copied' : 'Copy link'}
                </Button>
              </div>
            </div>
          </Panel>

          <ParticipantRoster roster={roster} />

          <Panel title="Add a song as host" icon={<MusicNoteIcon size={18} weight="duotone" />}>
            <PopularSongs roomId={roomId} onAdded={() => { void refresh(); }} />
            <div className="mt-4 border-t border-line pt-4">
              <SongSearch roomId={roomId} onAdded={() => { void refresh(); }} />
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <PasteSongForm roomId={roomId} onAdded={() => { void refresh(); }} />
            </div>
          </Panel>

          <Panel title="Host controls" icon={<LockKeyIcon size={18} weight="duotone" />}>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<LockSimpleIcon size={16} weight="duotone" />} onClick={() => void runCommand('lock')}>
                Lock
              </Button>
              <Button variant="secondary" size="sm" icon={<TrashIcon size={16} weight="duotone" />} onClick={() => void runCommand('clear_queue')}>
                Clear queue
              </Button>
              <Button variant="danger" size="sm" icon={<PowerIcon size={16} weight="duotone" />} onClick={() => void runCommand('end')}>
                End room
              </Button>
            </div>
            {commandError === null ? null : (
              <p role="alert" className="mt-3 rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{commandError}</p>
            )}
          </Panel>
        </aside>
      </div>
    </main>
  );
}
