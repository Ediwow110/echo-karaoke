import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import SongSearchPanel from '../../src/features/queue/SongSearchPanel';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
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
          : { available: false, results: [], message: 'Search is not configured. Paste a YouTube link instead.' };
      }
      if (name === 'queue-command') {
        return { ...queued, position: 3 };
      }
      return {};
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

function renderPanel(api: EdgeApi, queue: QueueEntry[] = []) {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass-value');
  return render(
    createElement(RoomApiProvider, {
      api,
      children: createElement(SongSearchPanel, {
        roomId,
        queue,
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
  it('searches as the singer types and adds a song', async () => {
    const { api, calls } = makeApi();
    renderPanel(api);

    await search();
    const add = await screen.findByRole('button', { name: /^add$/i }, { timeout: 4000 });
    fireEvent.click(add);

    await waitFor(() => {
      expect(calls).toContain('queue-command');
      expect(calls).toContain('youtube-search');
    });
    expect(await screen.findByText(/dancing queen added/i)).toBeInTheDocument();
  });

  it('marks a song that is already active as queued and disables adding it', async () => {
    const { api, calls } = makeApi();
    renderPanel(api, [queued]);

    await search();

    expect(await screen.findByText(/already in queue · #2/i)).toBeInTheDocument();
    const added = screen.getByRole('button', { name: /added/i });
    expect(added).toBeDisabled();
    expect(calls).not.toContain('queue-command');
  });

  it('shows the honest fallback when YouTube search is not configured', async () => {
    const { api } = makeApi(false);
    renderPanel(api);

    await search();

    expect(await screen.findByText(/search is not configured/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/paste a youtube link/i)).toBeInTheDocument();
  });
});
