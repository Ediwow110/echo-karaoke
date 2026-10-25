import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SongbookList from '../../src/features/catalog/SongbookList';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const PAGE_SIZE = 30;

function songAt(index: number) {
  return {
    videoId: 'video' + String(index).padStart(6, '0'),
    title: (index === 0 ? 'Halo - Beyonce' : 'Song ' + index) + ' (Karaoke)',
    channelTitle: 'Musisi Karaoke',
    thumbnailUrl: null,
    publishedAt: '2025-01-02T00:00:00Z',
  };
}

type CatalogPayload = { total: number; items: ReturnType<typeof songAt>[] };

// Each page carries its own ids so a replace-instead-of-append regression drops
// the first page's rows instead of silently passing on a repeated fixture.
function catalogPage(offset = 0): CatalogPayload {
  const items = Array.from({ length: PAGE_SIZE }, (_, index) => songAt(offset + index));
  return { total: 61, items };
}

function makeApi() {
  const calls: Array<{ name: string; body: unknown }> = [];
  const api = {
    invoke: (async (name: string, body: unknown) => {
      calls.push({ name, body });
      if (name === 'catalog-page') {
        const offset = (body as { offset?: number }).offset ?? 0;
        return catalogPage(offset);
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

    // First paint is a quiet loading line, not the warming-up copy.
    expect(screen.getByRole('status', { name: /loading the songbook/i })).toBeInTheDocument();
    expect(screen.queryByText(/warming up/i)).not.toBeInTheDocument();

    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('61 songs');

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
    expect(await screen.findByText('Song 30 (Karaoke)')).toBeInTheDocument();
    expect(screen.getByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /add halo/i })[0]);
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'queue-command')).toBe(true);
    });
  });

  it('keeps the newest results when an older search response lands late', async () => {
    const pending = new Map<string, (page: CatalogPayload) => void>();
    const api = {
      invoke: (async (name: string, body: unknown) => {
        if (name !== 'catalog-page') return { ok: true };
        const query = (body as { query?: string }).query ?? '';
        return new Promise<CatalogPayload>((resolve) => { pending.set(query, resolve); });
      }) as unknown as EdgeApi['invoke'],
    };
    render(<SongbookList api={api} roomId={roomId} />);

    await waitFor(() => { expect(pending.has('')).toBe(true); });
    await act(async () => { pending.get('')!(catalogPage(0)); });
    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();

    const input = screen.getByLabelText(/search the songbook/i);
    fireEvent.change(input, { target: { value: 'a' } });
    await waitFor(() => { expect(pending.has('a')).toBe(true); });
    // A refetch keeps the rows already on screen and marks the list busy.
    expect(screen.getByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /songbook songs/i })).toHaveAttribute('aria-busy', 'true');

    fireEvent.change(input, { target: { value: 'ab' } });
    await waitFor(() => { expect(pending.has('ab')).toBe(true); });

    await act(async () => { pending.get('ab')!(catalogPage(60)); });
    expect(await screen.findByText('Song 60 (Karaoke)')).toBeInTheDocument();

    await act(async () => { pending.get('a')!(catalogPage(30)); });
    await waitFor(() => {
      expect(screen.queryByText('Song 30 (Karaoke)')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Song 60 (Karaoke)')).toBeInTheDocument();
  });

  it('appends a page without repeating a song already on screen', async () => {
    const api = {
      invoke: (async (name: string, body: unknown) => {
        if (name !== 'catalog-page') return { ok: true };
        const offset = (body as { offset?: number }).offset ?? 0;
        // The second page overlaps the first by one id, as a clamped or
        // re-sorted server page can.
        if (offset === 0) return catalogPage(0);
        return {
          total: 61,
          items: Array.from({ length: PAGE_SIZE }, (_, index) => songAt(29 + index)),
        };
      }) as unknown as EdgeApi['invoke'],
    };
    render(<SongbookList api={api} roomId={roomId} />);

    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText('Song 58 (Karaoke)')).toBeInTheDocument();

    expect(screen.getAllByRole('listitem')).toHaveLength(59);
    expect(screen.getAllByText('Song 29 (Karaoke)')).toHaveLength(1);
  });
});
