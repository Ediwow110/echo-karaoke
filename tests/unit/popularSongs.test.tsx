import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
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

function renderStrip(available: boolean, moreHref?: string) {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
  return render(
    createElement(RoomApiProvider, {
      api: fakeApi(available),
      children: createElement(
        MemoryRouter,
        null,
        createElement(PopularSongs, { roomId, moreHref }),
      ),
    }),
  );
}

describe('popular songs', () => {
  it('shows a useful unavailable state and songbook link for the vertical host panel', async () => {
    localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
    const { container } = render(
      createElement(RoomApiProvider, {
        api: fakeApi(false),
        children: createElement(MemoryRouter, null,
          createElement(PopularSongs, {
            roomId, layout: 'vertical', moreHref: '/room/' + roomId + '/host/songbook',
          })),
      }),
    );
    expect(await screen.findByText(/popular suggestions are unavailable right now/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse the songbook/i }))
      .toHaveAttribute('href', '/room/' + roomId + '/host/songbook');
    expect(container.querySelector('[data-layout="vertical"]')).not.toBeNull();
  });

  it('reports an upstream error on the host without inventing suggestions', async () => {
    const api: EdgeApi = {
      invoke: (async () => { throw new Error('upstream failed'); }) as unknown as EdgeApi['invoke'],
    };
    localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
    render(createElement(RoomApiProvider, {
      api, children: createElement(MemoryRouter, null,
        createElement(PopularSongs, { roomId, layout: 'vertical' })),
    }));
    expect(await screen.findByText(/popular suggestions could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^queue /i })).not.toBeInTheDocument();
  });

  it('supports a keyboard-scrollable vertical host suggestion list', async () => {
    localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
    const { container } = render(
      createElement(RoomApiProvider, {
        api: fakeApi(true),
        children: createElement(MemoryRouter, null,
          createElement(PopularSongs, { roomId, layout: 'vertical' })),
      }),
    );
    await screen.findByRole('button', { name: /queue dancing queen/i });
    const list = container.querySelector('[data-layout="vertical"]');
    expect(list).toHaveAttribute('tabindex', '0');
    expect(list?.className).toContain('overflow-y-auto');
    expect(screen.queryByRole('button', { name: /next popular karaoke songs/i })).not.toBeInTheDocument();
  });
  it('offers each suggestion as a queue button', async () => {
    renderStrip(true);
    const button = await screen.findByRole('button', { name: /queue dancing queen/i });
    expect(button).toBeInTheDocument();
  });

  it('keeps the lyrics caption when there is no songbook destination', async () => {
    renderStrip(true);

    expect(await screen.findByText('With lyrics')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view more/i })).not.toBeInTheDocument();
  });

  it('links to the songbook when a destination is given', async () => {
    renderStrip(true, '/room/' + roomId + '/songbook');

    const link = await screen.findByRole('link', { name: 'View more' });
    expect(link).toHaveAttribute('href', '/room/' + roomId + '/songbook');
    expect(screen.queryByText('With lyrics')).not.toBeInTheDocument();
  });

  it('hides itself when suggestions are not configured', async () => {
    const { container } = renderStrip(false);
    await waitFor(() => {
      expect(container.querySelector('[data-suggestions]')).toBeNull();
    });
  });

  it('explains a song that could not be queued', async () => {
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'youtube-popular') {
          return { available: true, results: [song] };
        }
        throw new Error('That is five songs this minute. Wait a moment.');
      }) as unknown as EdgeApi['invoke'],
    };
    localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
    render(
      createElement(RoomApiProvider, {
        api,
        children: createElement(PopularSongs, { roomId }),
      }),
    );

    const button = await screen.findByRole('button', { name: /queue dancing queen/i });
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(/five songs this minute/i);
  });
});
