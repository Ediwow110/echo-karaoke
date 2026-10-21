import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import SongSearch, { watchUrl } from '../../src/features/queue/SongSearch';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const song = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Dancing Queen',
  channelTitle: 'ABBA',
  thumbnailUrl: null,
  durationSeconds: null,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function fakeApi(options: { available?: boolean } = {}): { api: EdgeApi; calls: string[] } {
  const calls: string[] = [];
  const available = options.available ?? true;

  const api: EdgeApi = {
    invoke: (async (name: string) => {
      calls.push(name);
      if (name === 'youtube-suggest') {
        return { suggestions: ['dancing queen karaoke', 'dancing queen abba'] };
      }
      if (name === 'youtube-search') {
        return available
          ? { available: true, results: [song] }
          : { available: false, results: [], message: 'Search is not configured.' };
      }
      return { songId: 's1', title: 'Dancing Queen', position: 1 };
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

function renderSearch(api: EdgeApi) {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
  return render(
    createElement(RoomApiProvider, { api, children: createElement(SongSearch, { roomId }) }),
  );
}

async function type(value: string) {
  fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value } });
}

describe('typing for songs', () => {
  it('shows songs from YouTube as the singer types', async () => {
    const { api, calls } = fakeApi();
    renderSearch(api);

    await type('dancing');

    expect(await screen.findByText('Dancing Queen')).toBeInTheDocument();
    expect(calls).toContain('youtube-search');
    expect(calls).toContain('youtube-suggest');
  });

  it('queues a song found by typing', async () => {
    const { api, calls } = fakeApi();
    renderSearch(api);

    await type('dancing');
    fireEvent.click(await screen.findByRole('button', { name: /^queue$/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/in the queue/i);
    });
    expect(calls).toContain('queue-command');
  });

  it('links a song out to YouTube', async () => {
    const { api } = fakeApi();
    renderSearch(api);

    await type('dancing');

    const link = await screen.findByRole('link', { name: /open dancing queen on youtube/i });
    expect(link).toHaveAttribute('href', watchUrl('dQw4w9WgXcQ'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('falls back to YouTube suggestions and explains the missing key', async () => {
    const { api } = fakeApi({ available: false });
    renderSearch(api);

    await type('dancing');

    expect(await screen.findByRole('button', { name: 'dancing queen karaoke' })).toBeInTheDocument();
    expect(screen.getByText(/need a data api key/i)).toBeInTheDocument();
  });

  it('does not call YouTube for a single character', async () => {
    const { api, calls } = fakeApi();
    renderSearch(api);

    await type('a');
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(calls).not.toContain('youtube-search');
    expect(calls).not.toContain('youtube-suggest');
  });

  it('offers a control that returns to the queue', () => {
    const { api } = fakeApi();
    renderSearch(api);

    expect(screen.getByRole('button', { name: /view queue/i })).toBeInTheDocument();
  });
});
