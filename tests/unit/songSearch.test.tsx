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
        return { suggestions: ['dancing queen', 'dancing queen karaoke'] };
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

describe('song typeahead', () => {
  it('shows YouTube suggestions while typing', async () => {
    const { api, calls } = fakeApi();
    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: 'dancing' } });

    expect(await screen.findByRole('button', { name: 'dancing queen karaoke' })).toBeInTheDocument();
    expect(calls).toContain('youtube-suggest');
  });

  it('turns a chosen suggestion into matching songs', async () => {
    const { api, calls } = fakeApi();
    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: 'dancing' } });
    fireEvent.click(await screen.findByRole('button', { name: 'dancing queen' }));

    expect(await screen.findByText('Dancing Queen')).toBeInTheDocument();
    expect(calls).toContain('youtube-search');
  });

  it('does not look anything up for a single character', async () => {
    const { api, calls } = fakeApi();
    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: 'a' } });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls).not.toContain('youtube-suggest');
  });

  it('queues a chosen song and confirms it', async () => {
    const { api, calls } = fakeApi();
    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: 'dancing' } });
    fireEvent.click(await screen.findByRole('button', { name: 'dancing queen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^queue$/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/in the queue/i);
    });
    expect(calls).toContain('queue-command');
  });

  it('links a song out to YouTube', async () => {
    const { api } = fakeApi();
    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: 'dancing' } });
    fireEvent.click(await screen.findByRole('button', { name: 'dancing queen' }));

    const link = await screen.findByRole('link', { name: /open dancing queen on youtube/i });
    expect(link).toHaveAttribute('href', watchUrl('dQw4w9WgXcQ'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('explains when song search needs a key', async () => {
    const { api } = fakeApi({ available: false });
    renderSearch(api);

    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: 'dancing' } });
    fireEvent.click(await screen.findByRole('button', { name: 'dancing queen' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/needs a youtube key/i);
  });

  it('offers a control that returns to the queue', () => {
    const { api } = fakeApi();
    renderSearch(api);

    expect(screen.getByRole('button', { name: /view queue/i })).toBeInTheDocument();
  });
});
