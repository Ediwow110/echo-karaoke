import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import SongSearchPanel from '../../src/features/queue/SongSearchPanel';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import { RoomApiError, type EdgeApi } from '../../src/lib/edgeApi';
import type { QueueEntry } from '../../src/features/rooms/useRoomData';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const result = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Dancing Queen',
  channelTitle: 'ABBA',
  thumbnailUrl: null,
  durationSeconds: null,
};
const playing: QueueEntry = {
  songId: 's0',
  videoId: 'playingSong1',
  title: 'Current Song',
  channelTitle: 'ABBA',
  thumbnailUrl: null,
  durationSeconds: null,
  status: 'playing',
  position: 1,
  memberId: 'm1',
  addedBy: 'Alex',
  voteCount: 0,
};
const queued: QueueEntry = {
  songId: 's1',
  videoId: 'dQw4w9WgXcQ',
  title: 'Dancing Queen',
  channelTitle: 'ABBA',
  thumbnailUrl: null,
  durationSeconds: null,
  status: 'queued',
  position: 2,
  memberId: 'm1',
  addedBy: 'Alex',
  voteCount: 0,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function makeApi(available = true): { api: EdgeApi; calls: string[] } {
  const calls: string[] = [];
  const api: EdgeApi = {
    invoke: (async (name: string) => {
      calls.push(name);
      if (name === 'youtube-search') {
        return available
          ? { available: true, results: [result] }
          : { available: false, results: [] };
      }
      if (name === 'queue-command') {
        return { ...queued, position: 3 };
      }
      return {};
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

function renderPanel(api: EdgeApi, queue: QueueEntry[] = [], variant: 'host' | 'guest' = 'guest') {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass-value');
  return render(
    createElement(RoomApiProvider, {
      api,
      children: createElement(SongSearchPanel, {
        roomId,
        queue,
        variant,
        onAdded: () => undefined,
        onOpenQueue: () => undefined,
      }),
    }),
  );
}

async function search(term = 'dancing queen') {
  fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: term } });
}

describe('song search panel', () => {
  it.each(['host', 'guest'] as const)('offers search without a paste-link form for %s', async (variant) => {
    const { api } = makeApi();
    renderPanel(api, [], variant);

    expect(screen.getByLabelText(/find a song on youtube/i)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /add a song by youtube link/i })).not.toBeInTheDocument();
    await search();
    expect(await screen.findByRole('button', { name: /^add dancing queen$/i })).toBeEnabled();
    expect(screen.queryByRole('form', { name: /add a song by youtube link/i })).not.toBeInTheDocument();
  });

  it('does not run the debounced search twice when Enter is pressed', async () => {
    const { api, calls } = makeApi();
    renderPanel(api);

    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: 'dancing queen' } });
    fireEvent.submit(screen.getByRole('search'));

    await waitFor(() => {
      expect(calls.filter((name) => name === 'youtube-search')).toHaveLength(1);
    });
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    expect(calls.filter((name) => name === 'youtube-search')).toHaveLength(1);
  });
  it('adds a pasted YouTube link directly without spending YouTube search quota', async () => {
    const { api, calls } = makeApi();
    renderPanel(api);
    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
    });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(calls).toContain('queue-command'));
    await new Promise((resolve) => window.setTimeout(resolve, 480));
    expect(calls).not.toContain('youtube-search');
    expect(screen.getByLabelText(/find a song on youtube/i)).toHaveValue('');
  });

  it('searches as the singer types and adds a song', async () => {
    const { api, calls } = makeApi();
    renderPanel(api);

    await search();
    const add = await screen.findByRole('button', { name: /^add dancing queen$/i }, { timeout: 4000 });
    fireEvent.click(add);

    await waitFor(() => {
      expect(calls).toContain('queue-command');
      expect(calls).toContain('youtube-search');
    });
    expect(await screen.findByText(/dancing queen added/i)).toBeInTheDocument();
  });

  it('marks a song that is already active as queued and disables adding it', async () => {
    const { api, calls } = makeApi();
    renderPanel(api, [playing, queued]);

    await search();

    expect(await screen.findByText(/already in queue · #1/i)).toBeInTheDocument();
    const added = screen.getByRole('button', { name: /already in the queue/i });
    expect(added).toBeDisabled();
    expect(calls).not.toContain('queue-command');
  });

  it('shows the manual fallback when YouTube search is not configured', async () => {
    const { api, calls } = makeApi(false);
    renderPanel(api);

    await search();

    expect(await screen.findByText(/search is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/ask the host to enable youtube search/i);
    const form = screen.getByRole('form', { name: /add a song by youtube link/i });
    const input = screen.getByLabelText(/add by youtube link/i);
    fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: /^add link$/i }));
    await waitFor(() => expect(calls).toContain('queue-command'));
    expect(form).toBeInTheDocument();
  });

  it('offers retry instead of pasting a link when search is unreachable', async () => {
    const api: EdgeApi = {
      invoke: (async () => {
        throw new RoomApiError('NETWORK_ERROR', 0, 'Network failed');
      }) as unknown as EdgeApi['invoke'],
    };
    renderPanel(api);
    await search();

    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube search is unreachable right now. Try again.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/paste a youtube link/i)).not.toBeInTheDocument();
  });

  it('drops a stale search failure once the box holds a video link', async () => {
    // A pasted link turns the box into "add this video". Leaving the failed
    // search's banner up claims an outage beside a working action, and its
    // Retry button would add the link rather than repeat a search.
    const api: EdgeApi = {
      invoke: (async () => {
        throw new RoomApiError('NETWORK_ERROR', 0, 'Network failed');
      }) as unknown as EdgeApi['invoke'],
    };
    renderPanel(api);
    await search();

    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube search is unreachable right now. Try again.');

    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
    });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
