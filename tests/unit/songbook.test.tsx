import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SongbookList from '../../src/features/catalog/SongbookList';
import { RoomApiError, type EdgeApi } from '../../src/lib/edgeApi';
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

type SyncResult = { available: boolean; added: number; skipped: number; message?: string };

// A catalog the host can fill by refreshing: every read is empty until a sync runs,
// and any search misses so the empty-catalog and no-match states stay separable.
function makeEmptyApi(syncResult: SyncResult) {
  const calls: Array<{ name: string; body: unknown }> = [];
  let synced = false;
  const api = {
    invoke: (async (name: string, body: unknown) => {
      calls.push({ name, body });
      if (name === 'catalog-page') {
        const query = (body as { query?: string }).query ?? '';
        if (synced && query === '') return catalogPage(0);
        return { total: 0, items: [] };
      }
      if (name === 'catalog-sync') {
        // The catalog only fills when the sync actually wrote rows.
        if (syncResult.added > 0) synced = true;
        return syncResult;
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

  it('narrows by channel chip', async () => {
    const { api, calls } = makeApi();
    render(<SongbookList api={api} roomId={roomId} channels={[{ id: 'UC_sing', label: 'Sing King' }]} />);

    expect(screen.getByRole('group', { name: 'Filter by channel' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Sing King' }));
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-page'
        && (call.body as { channel?: string }).channel === 'UC_sing')).toBe(true);
    });
  });

  it('keeps every Add button inert while the guest lock is on', async () => {
    const { api, calls } = makeApi();
    // Without a pass the queue helper throws before invoking, which would make
    // the "no queue-command" assertion pass for the wrong reason.
    localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass-value');
    render(<SongbookList api={api} roomId={roomId} disabled />);

    const adds = await screen.findAllByRole('button', { name: /^add /i });
    expect(adds).toHaveLength(PAGE_SIZE);

    await act(async () => {
      for (const add of adds) {
        fireEvent.click(add);
      }
    });
    expect(calls.some((call) => call.name === 'queue-command')).toBe(false);
    for (const add of adds) {
      expect(add).toBeDisabled();
    }

    // Browsing still works behind the lock, so the guest can plan a set.
    fireEvent.change(screen.getByLabelText(/search the songbook/i), { target: { value: 'halo' } });
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-page'
        && (call.body as { query?: string }).query === 'halo')).toBe(true);
    });
  });

  it('renders no channel chips unless the labels are supplied', async () => {
    const { api } = makeApi();
    render(<SongbookList api={api} roomId={roomId} />);

    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });

  it('does not tell a host to ask the host', async () => {
    // The guest line is right for a phone remote. On the host screen the refresh
    // button sits directly above this sentence, so telling the reader to ask the
    // host was telling them to ask themselves.
    const host = makeEmptyApi({ available: true, added: 0, skipped: 0 });
    render(<SongbookList api={host.api} roomId={roomId} canSync />);
    const hostCopy = await screen.findByText(/warming up/i);
    expect(hostCopy).toHaveTextContent(/refresh it/i);
    expect(hostCopy.textContent).not.toMatch(/ask the host/i);
    cleanup();

    const guest = makeEmptyApi({ available: true, added: 0, skipped: 0 });
    render(<SongbookList api={guest.api} roomId={roomId} />);
    expect(await screen.findByText(/warming up/i)).toHaveTextContent(/ask the host/i);
  });

  it('lets the host refresh a catalog that has not been synced yet', async () => {
    const { api, calls } = makeEmptyApi({ available: true, added: 412, skipped: 0 });
    render(<SongbookList api={api} roomId={roomId} canSync />);

    expect(await screen.findByText(/warming up/i)).toBeInTheDocument();
    // The guest copy asks the host to refresh, so the host must have the control.
    fireEvent.click(screen.getByRole('button', { name: /refresh the songbook/i }));

    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-sync')).toBe(true);
    });
    // The sync is only useful if the list is read again afterwards.
    await waitFor(() => {
      expect(calls.filter((call) => call.name === 'catalog-page').length).toBeGreaterThan(1);
    });
    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    expect(await screen.findByText('61 songs')).toBeInTheDocument();
  });

  it('names the throttle when the walk never looked at YouTube', async () => {
    // Every channel inside its six-hour window answers 'skipped' and adds
    // nothing. Telling the host the channels "have nothing new" states a fact
    // about YouTube that this run never checked -- the true cause is our own
    // schedule, and it is the reason a second press does nothing.
    const { api } = makeEmptyApi({ available: true, added: 0, skipped: 4 });
    render(<SongbookList api={api} roomId={roomId} canSync />);

    fireEvent.click(await screen.findByRole('button', { name: /refresh the songbook/i }));

    expect(await screen.findByText(/last six hours/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing new/i)).toBeNull();
  });

  it('lets the host refresh an already populated songbook without clearing the list', async () => {
    const { api, calls } = makeApi();
    render(<SongbookList api={api} roomId={roomId} canSync />);
    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh the songbook/i }));
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-sync')).toBe(true);
    });
    expect(screen.getByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
  });

  it('reports a concurrent refresh as a wait rather than a failure', async () => {
    // Another host already holds the walk, so the operation answers 409. The songbook
    // is not broken and must not read as red.
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'catalog-page') return { total: 61, items: [songAt(0)] };
        throw new RoomApiError('CATALOG_REFRESH_RUNNING', 409, 'The songbook is already being refreshed');
      }) as unknown as EdgeApi['invoke'],
    };
    render(<SongbookList api={api} roomId={roomId} canSync />);

    fireEvent.click(await screen.findByRole('button', { name: /refresh the songbook/i }));

    expect(await screen.findByText(/already being refreshed/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still reports a real refresh failure as an error', async () => {
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'catalog-page') return { total: 61, items: [songAt(0)] };
        throw new RoomApiError('INTERNAL_ERROR', 500, 'The songbook could not be refreshed');
      }) as unknown as EdgeApi['invoke'],
    };
    render(<SongbookList api={api} roomId={roomId} canSync />);

    fireEvent.click(await screen.findByRole('button', { name: /refresh the songbook/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be refreshed/i);
  });

  it('does not expose a refresh action to guests even when the catalog is populated', async () => {
    const { api, calls } = makeApi();
    render(<SongbookList api={api} roomId={roomId} />);
    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh the songbook/i })).not.toBeInTheDocument();
    expect(calls.some((call) => call.name === 'catalog-sync')).toBe(false);
  });

  it('shows the host why a refresh added nothing', async () => {
    const { api } = makeEmptyApi({
      available: true, added: 0, skipped: 5, message: 'Songbook refresh paused for today',
    });
    render(<SongbookList api={api} roomId={roomId} canSync />);

    fireEvent.click(await screen.findByRole('button', { name: /refresh the songbook/i }));

    expect(await screen.findByText('Songbook refresh paused for today')).toBeInTheDocument();
  });

  it('offers the host no refresh control', async () => {
    const { api, calls } = makeEmptyApi({ available: true, added: 1, skipped: 0 });
    render(<SongbookList api={api} roomId={roomId} />);

    expect(await screen.findByText(/warming up/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh the songbook/i })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search the songbook/i), { target: { value: 'halo' } });
    });
    expect(calls.some((call) => call.name === 'catalog-sync')).toBe(false);
  });

  it('calls an empty search a missed search, not an unsynced catalog', async () => {
    const { api } = makeEmptyApi({ available: true, added: 0, skipped: 0 });
    render(<SongbookList api={api} roomId={roomId} canSync />);

    expect(await screen.findByText(/warming up/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search the songbook/i), { target: { value: 'nothing' } });
    });

    expect(await screen.findByText(/no song matches/i)).toBeInTheDocument();
    expect(screen.queryByText(/warming up/i)).not.toBeInTheDocument();
  });

  it('says when the songbook is deeper than the list can reach', async () => {
    // Paging stops at the database's offset clamp, so with a deeper catalog the
    // header's total is a number the host can never scroll to. The count and
    // the reachable set must be told apart, not left to diverge silently.
    const deepApi = {
      invoke: (async () => ({ total: 5030, items: catalogPage(0).items })) as unknown as EdgeApi['invoke'],
    };
    render(<SongbookList api={deepApi} roomId={roomId} />);

    expect(await screen.findByText(/first 5,000 songs/i)).toHaveTextContent('5,030');
  });

  it('says nothing about a ceiling when the whole catalog fits', async () => {
    const { api } = makeApi();
    render(<SongbookList api={api} roomId={roomId} />);

    await waitFor(() => expect(screen.getByText('61 songs')).toBeInTheDocument());
    expect(screen.queryByText(/first 5,000 songs/i)).not.toBeInTheDocument();
  });
});
