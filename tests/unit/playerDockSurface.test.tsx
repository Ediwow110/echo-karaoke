import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlayerDock from '../../src/features/playback/PlayerDock';
import { HostPlayerContext, type HostPlayerValue } from '../../src/features/playback/useHostPlayer';
import type { PlaybackState } from '../../src/features/playback/playbackApi';
import type { QueueEntry } from '../../src/features/rooms/useRoomData';
import '@testing-library/jest-dom/vitest';

const nowPlaying: QueueEntry = {
  songId: 'song-1',
  videoId: 'dQw4w9WgXcQ',
  title: 'Afterglow',
  channelTitle: 'Example',
  thumbnailUrl: null,
  durationSeconds: 215,
  status: 'playing',
  position: 1,
  memberId: 'm1',
  addedBy: 'Ana',
  voteCount: 0,
};

const playback: PlaybackState = {
  currentSongId: 'song-1',
  currentVideoId: 'dQw4w9WgXcQ',
  positionSeconds: 0,
  durationSeconds: 215,
  isPlaying: false,
  updatedAt: null,
};

afterEach(cleanup);

function renderDock(playbackSurfaceReady: boolean): void {
  const value: HostPlayerValue = {
    needsTap: false,
    playerError: null,
    advanceStalled: false,
    loading: false,
    currentTime: 0,
    duration: 215,
    volume: 85,
    fullscreen: false,
    stageActive: false,
    playbackSurfaceReady,
    registerStageSlot: () => undefined,
    requestPlay: () => undefined,
    seekBy: () => undefined,
    seekTo: () => undefined,
    setVolume: () => undefined,
    toggleFullscreen: () => undefined,
    skipFailed: () => undefined,
    retryAdvance: () => undefined,
    findAlternative: () => undefined,
  };

  render(
    <MemoryRouter>
      <HostPlayerContext.Provider value={value}>
        <PlayerDock
          roomId="room-1"
          nowPlaying={nowPlaying}
          playback={playback}
          onTogglePlay={() => Promise.resolve()}
          onNext={() => Promise.resolve()}
        />
      </HostPlayerContext.Provider>
    </MemoryRouter>,
  );
}

describe('the host dock when this screen has no video surface', () => {
  it('does not offer Play when the player would be paused again immediately', () => {
    renderDock(false);

    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeDisabled();
  });

  it('says where playback can actually be started', () => {
    renderDock(false);

    expect(screen.getByText(/open the stage view to control playback/i)).toBeInTheDocument();
  });

  it('keeps the controls live when the video is on screen', () => {
    renderDock(true);

    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeEnabled();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeEnabled();
    expect(screen.queryByText(/open the stage view to control playback/i)).toBeNull();
  });
});
