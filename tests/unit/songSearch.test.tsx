import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import SongSearch, { watchUrl } from '../../src/features/queue/SongSearch';
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

function apiWithResults(): { api: EdgeApi; calls: string[] } {
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
  return { api, calls };
}

describe('song search', () => {
  it('builds a watch link for a result', () => {
    expect(watchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('queues a searched song and confirms it landed in the queue', async () => {
    const { api, calls } = apiWithResults();
    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/search youtube/i), { target: { value: 'rick astley' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText('Never Gonna Give You Up')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^queue$/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/in the queue/i);
    });
    expect(calls).toContain('queue-command');
  });

  it('links each result to YouTube in a new tab', async () => {
    const { api } = apiWithResults();
    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/search youtube/i), { target: { value: 'rick astley' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    const link = await screen.findByRole('link', { name: /open never gonna give you up on youtube/i });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('offers a control that returns to the queue', () => {
    const { api } = apiWithResults();
    renderSearch(api);

    expect(screen.getByRole('button', { name: /view queue/i })).toBeInTheDocument();
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