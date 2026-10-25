import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SongbookList from '../../src/features/catalog/SongbookList';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

function catalogPage() {
  const songs = Array.from({ length: 30 }, (_, index) => ({
    videoId: 'video' + String(index).padStart(6, '0'),
    title: (index === 0 ? 'Halo - Beyonce' : 'Song ' + index) + ' (Karaoke)',
    channelTitle: 'Musisi Karaoke',
    thumbnailUrl: null,
    publishedAt: '2025-01-02T00:00:00Z',
  }));
  return { total: 61, items: songs };
}

function makeApi() {
  const calls: Array<{ name: string; body: unknown }> = [];
  const api = {
    invoke: (async (name: string, body: unknown) => {
      calls.push({ name, body });
      if (name === 'catalog-page') {
        const offset = (body as { offset?: number }).offset ?? 0;
        const page = catalogPage();
        return { total: page.total, items: offset === 0 ? page.items : page.items.slice(0, 31 - 30) };
      }
      return { ok: true };
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('songbook list', () => {
  it('filters, pages, and queues a song', async () => {
    const { api, calls } = makeApi();
    localStorage.setItem('karaoke.host.' + roomId, 'host-pass-value');
    render(<SongbookList api={api} roomId={roomId} />);

    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    expect(screen.getByText(/61 songs/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/search the songbook/i), { target: { value: 'halo' } });
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-page'
        && (call.body as { query?: string }).query === 'halo')).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-page'
        && (call.body as { offset?: number }).offset === 30)).toBe(true);
    });

    fireEvent.click(screen.getAllByRole('button', { name: /add halo/i })[0]);
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'queue-command')).toBe(true);
    });
  });
});
