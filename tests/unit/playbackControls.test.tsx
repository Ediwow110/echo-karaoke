import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import PlaybackControls from '../../src/features/playback/PlaybackControls';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderControls(api: EdgeApi, playback: { isPlaying: boolean }, disabled = false, shape: 'dock' | 'bar' = 'bar') {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
  return render(
    createElement(RoomApiProvider, {
      api,
      children: createElement(PlaybackControls, {
        roomId,
        playback: {
          currentSongId: 's1',
          currentVideoId: 'dQw4w9WgXcQ',
          positionSeconds: 12,
          isPlaying: playback.isPlaying,
          updatedAt: null,
        },
        disabled,
        shape,
      }),
    }),
  );
}

describe('playback controls', () => {
  it('sends a play command when stopped', async () => {
    const sent: string[] = [];
    const api: EdgeApi = {
      invoke: (async (name: string, body: { action: string }) => {
        sent.push(name + ':' + body.action);
        return { roomId, status: 'live', playback: { isPlaying: true } };
      }) as unknown as EdgeApi['invoke'],
    };

    renderControls(api, { isPlaying: false });
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));

    await waitFor(() => {
      expect(sent).toEqual(['playback-command:play']);
    });
  });

  it('sends a skip command and keeps pause disabled while stopped', async () => {
    const sent: string[] = [];
    const api: EdgeApi = {
      invoke: (async (name: string, body: { action: string }) => {
        sent.push(name + ':' + body.action);
        return { roomId, status: 'live', playback: { isPlaying: false } };
      }) as unknown as EdgeApi['invoke'],
    };

    renderControls(api, { isPlaying: false });
    expect(screen.getByRole('button', { name: /^pause$/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /^skip$/i }));
    await waitFor(() => {
      expect(sent).toEqual(['playback-command:next']);
    });
  });

  it('disables every control when the host locks guests', () => {
    const api: EdgeApi = {
      invoke: (async () => ({})) as unknown as EdgeApi['invoke'],
    };

    renderControls(api, { isPlaying: false }, true);

    expect(screen.getByRole('button', { name: /^play$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeDisabled();
  });

  it('explains a locked rejection from the server', async () => {
    const api: EdgeApi = {
      invoke: (async () => {
        const error = new Error('locked') as Error & { code: string; status: number };
        error.code = 'GUEST_CONTROLS_LOCKED';
        error.status = 403;
        Object.setPrototypeOf(error, (await import('../../src/lib/edgeApi')).RoomApiError.prototype);
        throw error;
      }) as unknown as EdgeApi['invoke'],
    };

    renderControls(api, { isPlaying: false });
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/locked/i);
  });

  it('keeps the dock shape on one line with round buttons', () => {
    const api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] };
    const { container } = renderControls(api, { isPlaying: false }, false, 'dock');
    expect(container.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /^play$/i }).className).toContain('rounded-full');
  });
});
