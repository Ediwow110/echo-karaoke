import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import PopularSongs from '../../src/features/queue/PopularSongs';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const song = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Dancing Queen',
  channelTitle: 'ABBA',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  durationSeconds: null,
};

function fakeApi(available: boolean): EdgeApi {
  return {
    invoke: (async (name: string) => {
      if (name === 'youtube-popular') {
        return available ? { available: true, results: [song] } : { available: false, results: [] };
      }
      return { songId: 's1', title: 'Dancing Queen', position: 1 };
    }) as unknown as EdgeApi['invoke'],
  };
}

function renderStrip(available: boolean) {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
  return render(
    createElement(RoomApiProvider, {
      api: fakeApi(available),
      children: createElement(PopularSongs, { roomId }),
    }),
  );
}

describe('popular songs', () => {
  it('offers each suggestion as a queue button', async () => {
    renderStrip(true);
    const button = await screen.findByRole('button', { name: /queue dancing queen/i });
    expect(button).toBeInTheDocument();
  });

  it('hides itself when suggestions are not configured', async () => {
    const { container } = renderStrip(false);
    await waitFor(() => {
      expect(container.querySelector('[data-suggestions]')).toBeNull();
    });
  });
});
