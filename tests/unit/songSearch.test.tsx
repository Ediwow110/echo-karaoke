import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import SongSearch from '../../src/features/queue/SongSearch';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderSearch(api: EdgeApi) {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
  return render(
    createElement(RoomApiProvider, { api, children: createElement(SongSearch, { roomId }) }),
  );
}

describe('song search', () => {
  it('lists results and adds one to the queue', async () => {
    const calls: string[] = [];
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        calls.push(name);
        if (name === 'youtube-search') {
          return {
            available: true,
            results: [
              { videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', channelTitle: 'Rick Astley', thumbnailUrl: null, durationSeconds: null },
            ],
          };
        }
        return { songId: 's1', title: 'Never Gonna Give You Up', position: 1 };
      }) as unknown as EdgeApi['invoke'],
    };

    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/search youtube/i), { target: { value: 'rick astley' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText('Never Gonna Give You Up')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/added/i);
    });
    expect(calls).toContain('queue-command');
  });

  it('explains when search is not configured', async () => {
    const api: EdgeApi = {
      invoke: (async () => ({
        available: false,
        results: [],
        message: 'Search is not configured. Paste a YouTube link instead.',
      })) as unknown as EdgeApi['invoke'],
    };

    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/search youtube/i), { target: { value: 'abba' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/not configured/i);
  });

  it('reports an empty result set', async () => {
    const api: EdgeApi = {
      invoke: (async () => ({ available: true, results: [] })) as unknown as EdgeApi['invoke'],
    };

    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/search youtube/i), { target: { value: 'zzzz' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/no videos matched/i);
  });
});
