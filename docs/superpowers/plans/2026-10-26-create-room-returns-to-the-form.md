# Create Room Returns To The Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking "Create room" while hosting lands on the create-room form in every viewport (never the phone join screen), and the room the host just left stays one click away.

**Architecture:** A dedicated `/create` route renders the existing home screen with an explicit create intent, so a narrow window opens the create form instead of the join form; the landing route and the create route are keyed separately, because React Router reuses a route element when only the path changes. The hosted room the browser still holds a pass for is read from the session store through `getHostedRoom()`, and the **server** decides whether it is still alive: one `host-room-read` answers `live` or not, so a local timestamp can neither offer a dead room nor hide a live one. Ending a room forgets its session, so an ended room is never offered.

**Tech Stack:** React 19, React Router 7, Vite, Tailwind, Vitest + Testing Library (jsdom), Playwright UI checks with mocked `/api`.

**Status (2026-10-27):** committed on `feature/songbook` as `39fcc24` and **not deployed**. Production
still serves `862e747`, whose sidebar links "Create room" to `/` — verified by fetching the live
origin and grepping every served chunk for `/create` and `Back to the room` (zero hits in 35 chunks,
while the positive controls matched). The runbook section now reads
`## The create action opens the create form (committed 2026-10-26, NOT DEPLOYED as of 2026-10-27)`.

## Global Constraints

- Keep authorization, duplicate checks, room limits, and quota checks in SQL or the server. UI hiding is not authorization.
- Never log tokens, passes, cookies, connection strings, or raw IP addresses.
- Keep phone controls at least 44 by 44 pixels.
- No secrets in source, tests, commands, or chat.
- The landing page `/` keeps its current behaviour: join first on a narrow screen, create workspace on a wide one.
- The browser never receives a database URL.

---

### Task 1: A create route that always opens the create form

**Files:**
- Modify: `src/app/App.tsx` (add the `/create` route, keyed apart from the landing route)
- Modify: `src/app/HomePage.tsx` (accept a create intent)
- Modify: `src/features/rooms/Sidebar.tsx` (the "Create room" nav item and the "Start something good." card point at `/create`; the logo is named "kara-echo home")
- Modify: `src/features/rooms/AppShell.tsx` (the logo is named "kara-echo home")
- Modify: `src/app/HostRoomPage.tsx` (the mobile logo is named "kara-echo home")
- Modify: `src/app/CollectionPages.tsx` (the mobile "Create room" action points at `/create`)
- Modify: `src/features/library/SongCollectionView.tsx` (the "Create a room" link points at `/create`)
- Test: `tests/unit/homePage.test.tsx`, `tests/unit/app.test.ts`, `tests/unit/sidebarNav.test.tsx`

**Interfaces:**
- Consumes: nothing from later tasks.
- Produces: `HomePage` accepts `intent?: 'landing' | 'create'` (default `'landing'`). The route `/create` renders `HomePage` with `intent="create"`.

- [x] **Step 1: Write the failing test**

In `tests/unit/homePage.test.tsx`, add to `describe('create room workspace')`:

```tsx
it('opens the create form, not the join form, when the host asks to create a room', () => {
  stubWide(false);
  renderHomeAt('/create', { intent: 'create' });

  expect(screen.getByLabelText('Room name')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create room' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Room code')).toBeNull();
});
```

In `tests/unit/app.test.ts`, add:

```ts
it('opens the create form when the landing page hands over to the create route', async () => {
  renderHome();
  expect(screen.getByRole('heading', { name: /join the room/i })).toBeInTheDocument();

  window.history.pushState({}, '', '/create');
  window.dispatchEvent(new PopStateEvent('popstate'));

  await waitFor(() => {
    expect(screen.getByLabelText(/room name/i)).toBeInTheDocument();
  });
  expect(screen.queryByLabelText(/room code/i)).toBeNull();
});
```

In `tests/unit/sidebarNav.test.tsx`, add to `describe('the nav once a room exists')`:

```tsx
it('sends the create action to the create form, not the landing page', () => {
  renderSidebar({ roomId: '550e8400-e29b-41d4-a716-446655440000' });
  expect(nav().getByRole('link', { name: 'Create room' })).toHaveAttribute('href', '/create');
});
```

and to `describe('the nav before a room exists')`:

```tsx
it('sends the session card to the create form as well', () => {
  renderSidebar();
  expect(screen.getByRole('link', { name: /start something good/i })).toHaveAttribute('href', '/create');
});

it('names the logo for where it goes', () => {
  // The logo goes home. A name that promises "create a room" sends a screen
  // reader to the join-first landing page and promises something the
  // destination cannot do.
  renderSidebar();
  expect(screen.getByRole('link', { name: 'kara-echo home' })).toHaveAttribute('href', '/');
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/homePage.test.tsx tests/unit/app.test.ts tests/unit/sidebarNav.test.tsx`
Expected: FAIL — `/create` renders nothing (no route), the nav link still points at `/`, and the
landing page's join-first mode survives the handover to `/create` because React Router reuses the
route element.

- [x] **Step 3: Write the minimal implementation**

In `src/app/App.tsx`, add the route next to the landing route and key both apart:

```tsx
<Route path="/" element={<HomePage key="landing" />} />
<Route path="/create" element={<HomePage key="create" intent="create" />} />
```

In `src/app/HomePage.tsx`, accept the intent and use it for the narrow layout's opening mode:

```tsx
type HomePageProps = { intent?: 'landing' | 'create' };

export default function HomePage({ intent = 'landing' }: HomePageProps) {
  ...
  const [mode, setMode] = useState<'join' | 'host'>(intent === 'create' ? 'host' : 'join');
```

In `src/features/rooms/Sidebar.tsx`, point the nav item and the session card at the create route,
and name the logo for where it goes:

```tsx
{ key: 'create', label: 'Create room', href: '/create', icon: PlusIcon },
...
<Link to="/create" className="mt-2 inline-block text-[0.6875rem] text-signal hover:underline">
  Start something good.
</Link>
...
<Link to="/" className="px-2" aria-label="kara-echo home">
```

The same label change applies to the logo in `src/features/rooms/AppShell.tsx` and to the mobile
logo in `src/app/HostRoomPage.tsx`.

In `src/app/CollectionPages.tsx`:

```tsx
mobileAction={<Link to="/create" className="text-[0.75rem] font-semibold text-signal">Create room</Link>}
```

In `src/features/library/SongCollectionView.tsx`:

```tsx
<Link to="/create" className="text-[0.6875rem] font-semibold text-signal hover:underline">Create a room</Link>
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/homePage.test.tsx tests/unit/app.test.ts tests/unit/sidebarNav.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

Not committed: the owner approves commits for this repository, and the change was reviewed and
verified as one piece. See "Commit policy" below.

---

### Task 2: The room the host just left stays one click away

**Files:**
- Modify: `src/features/rooms/sessionStore.ts` (new `getHostedRoom()` and `forgetSession()`)
- Modify: `src/app/HostRoomPage.tsx` (an ended room forgets its session)
- Create: `src/features/rooms/ReturnToRoom.tsx` (the "Back to the room" link, gated by the server)
- Modify: `src/app/HomePage.tsx` (render the link in both layouts)
- Test: `tests/unit/sessionStore.test.ts`, `tests/unit/homePage.test.tsx`, `tests/unit/hostRoomPage.test.tsx`

**Interfaces:**
- Consumes: `loadHostToken` from `src/features/rooms/tokenStore.ts`; `readRoomAsHost` from `src/features/rooms/roomApi.ts`; `EdgeApi` from `src/lib/edgeApi.ts`.
- Produces:
  - `sessionStore.getHostedRoom(): RoomSession | null` — the most recent session with `role: 'host'` that still has a host pass in the token store. A candidate only: whether the room is alive is the server's answer.
  - `sessionStore.forgetSession(roomId: string): void` — drops that room's session, and clears the last-room pointer when it points at that room.
  - `ReturnToRoom` — a component taking `api: EdgeApi`; it reads the candidate room once with `readRoomAsHost` and renders nothing unless the answer is `status: 'live'`; otherwise it renders a link labelled "Back to the room" pointing at `/room/<roomId>/host`.

**Why the server decides whether the room is alive.**
`supabase/migrations/0019_abandoned_room_cleanup.sql` deletes a room only when it is older than
thirty minutes **and** no member has heartbeated in thirty minutes. A local timestamp therefore
cannot tell a live room from a dead one: it would either offer a room that is already gone or hide
a room whose guests are still standing in it. One `host-room-read` is the same answer the host
screen itself gets, and it costs one request on a screen the host is already looking at.

**What was tried and rejected.** An earlier draft stamped the session when the host screen unmounted
and offered the room for thirty minutes. Two problems killed it: `touchSession` also writes the
last-room pointer, so a room that had *ended* would be resurrected as an offer; and the local
window did not match the server's liveness rule at all. The shipped design asks the server instead
and never stamps anything on unmount.

- [x] **Step 1: Write the failing tests**

In `tests/unit/sessionStore.test.ts`:

```ts
it('offers the hosted room this browser still holds a pass for', () => {
  saveHostToken('room-a', 'host-pass');
  rememberSession({ roomId: 'room-a', code: 'CD53QS0NZ0SQS0N1', roomName: 'Room A', hostName: 'Host A', role: 'host' });

  expect(getHostedRoom()?.roomId).toBe('room-a');
});

it('offers nothing when the host pass is gone', () => {
  rememberSession({ roomId: 'room-a', code: 'CD53QS0NZ0SQS0N1', roomName: 'Room A', hostName: 'Host A', role: 'host' });

  expect(getHostedRoom()).toBeNull();
});

it('forgets an ended room so it is never offered again', () => {
  saveHostToken('room-a', 'host-pass');
  rememberSession({ roomId: 'room-a', code: 'CD53QS0NZ0SQS0N1', roomName: 'Room A', hostName: 'Host A', role: 'host' });

  forgetSession('room-a');

  expect(getHostedRoom()).toBeNull();
  expect(getLastRoom()).toBeNull();
});
```

The token store keeps a tab-local copy of every pass, so these tests call `clearRoomTokens('room-a')`
in `beforeEach`; `localStorage.clear()` alone leaves the pass behind.

In `tests/unit/homePage.test.tsx`, the home screen reads the room through the API, so the mock
answers the way the server does:

```tsx
function liveRoomApi(): EdgeApi {
  return {
    invoke: (async () => ({
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'live',
      room: { id: '550e8400-e29b-41d4-a716-446655440000', code: 'ABCDEFGHJKMNPQRS', name: 'After Hours', status: 'live' },
    })) as unknown as EdgeApi['invoke'],
  };
}
```

```tsx
it('keeps the room the host just left one click away', async () => {
  stubWide(true);
  saveHostToken('550e8400-e29b-41d4-a716-446655440000', 'host-pass');
  rememberSession({ roomId: '550e8400-e29b-41d4-a716-446655440000', code: 'ABCDEFGHJKMNPQRS', roomName: 'After Hours', hostName: 'Alex', role: 'host' });
  renderHome(liveRoomApi());

  expect(await screen.findByRole('link', { name: 'Back to the room' }))
    .toHaveAttribute('href', '/room/550e8400-e29b-41d4-a716-446655440000/host');
});

it('offers no way back to a room the server says has ended', async () => {
  stubWide(true);
  saveHostToken('550e8400-e29b-41d4-a716-446655440000', 'host-pass');
  rememberSession({ roomId: '550e8400-e29b-41d4-a716-446655440000', code: 'ABCDEFGHJKMNPQRS', roomName: 'After Hours', hostName: 'Alex', role: 'host' });
  renderHome({ invoke: (async () => ({ status: 'ended' })) as unknown as EdgeApi['invoke'] });

  await waitFor(() => {
    expect(screen.queryByRole('link', { name: 'Back to the room' })).toBeNull();
  });
});
```

In `tests/unit/hostRoomPage.test.tsx`, the host page must forget the room it ends:

```tsx
it('forgets the ended room so it is never offered back', async () => {
  clearRoomTokens(roomId);
  saveHostToken(roomId, 'host-pass-value');
  rememberSession({ roomId, code: 'ABCDEFGHJKMNPQRS', roomName: 'After Hours', hostName: 'Ana', role: 'host' });
  const { api } = makeApi();
  renderHost(api, '/room/' + roomId + '/host/settings');

  fireEvent.click(await screen.findByRole('button', { name: /leave & end room/i }));
  fireEvent.click(screen.getByRole('button', { name: /^end the room$/i }));

  expect(await screen.findByText('Back at the start')).toBeInTheDocument();
  expect(getHostedRoom()).toBeNull();
  expect(getLastRoom()).toBeNull();
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/sessionStore.test.ts tests/unit/homePage.test.tsx tests/unit/hostRoomPage.test.tsx`
Expected: FAIL — `getHostedRoom` and `forgetSession` do not exist, and no return link is rendered.

- [x] **Step 3: Write the minimal implementation**

In `src/features/rooms/sessionStore.ts`:

```ts
import { loadHostToken } from './tokenStore';

/**
 * The room this browser hosted and can still command.
 *
 * The host screen owns the only player, so a host who leaves it for another
 * room would otherwise lose the room their guests are still standing in. The
 * session is only a candidate: whether the room is still alive is the
 * server's answer, not a local timestamp.
 */
export function getHostedRoom(): RoomSession | null {
  return getSessions().find(
    (entry) => entry.role === 'host' && loadHostToken(entry.roomId) !== null,
  ) ?? null;
}

/**
 * Drop a room this browser no longer hosts. An ended room must not come back
 * as an offer, and the last-room pointer must not lead into it either.
 */
export function forgetSession(roomId: string): void {
  const remaining = getSessions().filter((entry) => entry.roomId !== roomId);
  writeJson(SESSIONS_KEY, remaining);
  const last = getLastRoom();
  if (last !== null && last.roomId === roomId) {
    clearLastRoom();
  }
}
```

In `src/app/HostRoomPage.tsx`, ending a room forgets it:

```ts
import { rememberSession, forgetSession } from '../features/rooms/sessionStore';

const endRoom = useCallback(async (): Promise<void> => {
  try {
    await sendHostCommand(api, roomId, 'end');
    roomClosedRef.current = true;
    // An ended room is not an offer any more, and the last-room pointer must
    // not lead back into it.
    forgetSession(roomId);
    navigate('/');
  } catch (caught) {
    notify('The room could not be ended.', caught instanceof Error ? caught.message : undefined, 'error');
  }
}, [api, navigate, notify, roomId]);
```

Create `src/features/rooms/ReturnToRoom.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EdgeApi } from '../../lib/edgeApi';
import { readRoomAsHost } from './roomApi';
import { getHostedRoom, type RoomSession } from './sessionStore';

type RoomRead = { status?: string };

export default function ReturnToRoom({ api, className }: { api: EdgeApi; className?: string }) {
  const [room, setRoom] = useState<RoomSession | null>(null);

  useEffect(() => {
    const candidate = getHostedRoom();
    if (candidate === null) {
      return;
    }
    let active = true;
    void readRoomAsHost<RoomRead>(api, candidate.roomId)
      .then((read) => {
        if (active && read.status === 'live') {
          setRoom(candidate);
        }
      })
      .catch(() => {
        // A room that cannot be read is a room this browser cannot return to.
        if (active) {
          setRoom(null);
        }
      });
    return () => {
      active = false;
    };
  }, [api]);

  if (room === null) {
    return null;
  }

  return (
    <p className={['text-[0.75rem] leading-[1.6] text-ink-2', className].filter(Boolean).join(' ')}>
      Still hosting <span className="font-semibold text-ink">{room.roomName}</span>?{' '}
      <Link to={'/room/' + room.roomId + '/host'} className="font-semibold text-signal hover:underline">
        Back to the room
      </Link>
    </p>
  );
}
```

In `src/app/HomePage.tsx`, render it in both layouts with the API it already has: in the narrow
layout under the intro paragraph, and in the wide layout directly above the create form's
"Make it your room." heading.

```tsx
<ReturnToRoom api={api} className="mt-6" />
...
<ReturnToRoom api={api} className="mb-5" />
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/sessionStore.test.ts tests/unit/homePage.test.tsx tests/unit/hostRoomPage.test.tsx`
Expected: PASS.

- [x] **Step 5: Run the whole unit suite**

Run: `npm test`
Expected: PASS, no new failures.

- [x] **Step 6: Commit**

Not committed — see "Commit policy" below.

---

### Task 3: The browser proof

**Files:**
- Modify: `tests/e2e/ui-mock.spec.ts`

**Interfaces:**
- Consumes: the `/create` route and the "Back to the room" link from Tasks 1 and 2.
- Produces: one Playwright UI check that drives the whole reported flow.

- [x] **Step 1: Write the failing test**

```ts
test('the create action opens the create form and keeps the hosted room one click away', async ({ page }) => {
  await mockApi(page);
  // The host session the browser still holds a pass for, the way the app
  // remembers it after the host screen opened the room.
  await page.addInitScript(([roomId, code]) => {
    localStorage.setItem('karaoke.sessions', JSON.stringify([{
      roomId,
      code,
      roomName: 'Mock Night',
      hostName: 'Ana',
      role: 'host',
      lastSeenAt: new Date().toISOString(),
    }]));
    localStorage.setItem('karaoke.last-room', JSON.stringify({ roomId, role: 'host' }));
  }, [ROOM, 'ABCDEFGHJKMNPQRS']);
  // A short window is where the create action used to answer with the phone
  // join screen instead of the form that creates a room.
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  await page.getByRole('link', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByLabel('Room name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create room' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /join the room/i })).toHaveCount(0);
  await expect(page.getByLabel('Room code')).toHaveCount(0);

  const back = page.getByRole('link', { name: 'Back to the room' });
  await expect(back).toHaveAttribute('href', '/room/' + ROOM + '/host');
  await back.click();
  await expect(page).toHaveURL(new RegExp('/room/' + ROOM + '/host$'));
  await expect(page.getByRole('heading', { level: 1, name: 'Mock Night' })).toBeVisible();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --config playwright.ui.config.ts -g "create action opens the create form"`
Expected: FAIL — the click lands on `/`, not `/create`.

**Red proof of the whole fix.** With the fix in place the check passes. Restoring the pre-fix
`src/` (`git checkout -- src/`) makes the same click land on `/` and the check fail with
`Expected pattern: /\/create$/ — Received string: "http://127.0.0.1:4173/"`. The fix was then
restored from the saved patch. This is the reported symptom, reproduced and closed.

- [x] **Step 3: The mock already answers like the server**

`mockApi` answers `/api/host-room-read` with `status: 'live'`, so the offer appears; the same mock
with `status: 'ended'` makes the offer disappear. The session seed above is what the app writes
when the host screen opens a room.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx playwright test --config playwright.ui.config.ts -g "create action opens the create form"`
Expected: PASS.

- [x] **Step 5: Run the whole UI suite**

Run: `npm run test:e2e:ui`
Expected: PASS, no new failures.

- [x] **Step 6: Commit**

Not committed — see "Commit policy" below.

---

### Task 4: Record what changed

**Files:**
- Modify: `docs/deployment/hosted-setup.md`

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 1-3.
- Produces: one documentation section, matching the file's existing convention.

- [x] **Step 1: Write the section**

The section is `## The create action opens the create form (committed 2026-10-26, NOT DEPLOYED as of
2026-10-27)` in `docs/deployment/hosted-setup.md`. It covers what was wrong, what ships now (including why the
server decides liveness), the proof against the running app, and the React Router keying note.

- [x] **Step 2: Update the verification checklist**

The checklist counts in the same file move with the tree: `npm test` 519 passing, `npm run build`
passing, `npm run test:e2e:ui` 17 passing.

- [x] **Step 3: Commit**

Not committed — see "Commit policy" below.

---

## Commit policy

This repository does not commit or deploy without the owner's explicit approval. The whole change
above is therefore left in the working tree, reviewed and verified, for the owner to commit.

## Review outcome

A reviewer subagent was dispatched over the diff (`requesting-code-review`). Its three Important
findings were confirmed against the code and fixed:

1. **Route reuse.** React Router v7 reuses a route element when only the path changes
   (`RenderedRoute` carries no key), so the landing page's join-first mode followed the host to
   `/create`. Fixed by keying the two routes apart; `tests/unit/app.test.ts` now pins it and fails
   when the keys are removed.
2. **Ended rooms came back.** `touchSession` writes the last-room pointer as well as the session,
   so stamping on unmount resurrected an ended room as an offer. Fixed by dropping the unmount
   stamp and forgetting the session when a room ends.
3. **Local liveness was wrong.** The sweep deletes a room only when *no* member has heartbeated for
   thirty minutes, so a thirty-minute local window would hide live rooms and offer dead ones.
   Fixed by asking the server with one `host-room-read`.

One Minor suggestion (re-wording the logo's `aria-label`) was raised in the first review round and
declined as a pre-existing brand decision. It was revisited after the `/create` route shipped and
then **fixed**: a control announced as "create a room" that lands on the join-first landing page
is the same defect the owner asked to close, and the app's own convention elsewhere
(`JoinRoomPage`, `ScanRoomPage`) is `aria-label="kara-echo home"` for the logo that goes home.

A later sweep over the source found two more controls in the same shape — the sidebar's
"Start something good." card (a create action that pointed at `/`) and the three logo links with
the "create a room" accessible name. Both were closed and pinned with tests.

## Final verification

Run on the finished tree:

- `npm test` — 519 passing (74 files).
- `npx tsc --noEmit` — clean.
- `npm run build` — exit 0.
- `npx playwright test --config playwright.ui.config.ts` — 17 passing.
- Playwright MCP against the running dev server: `/create` shows the create form ("Make it your
  room." on the wide layout, "Create room" on the narrow one) with no room code field at 1024x600
  and at 390x844, the return link carries the room's own URL and returns the host to the live host
  screen, the link disappears when the room answers `ended`, the sidebar's "Start something good."
  card lands on `/create`, the logo is named "kara-echo home", the narrow landing page still leads
  with "Join the room." and has no horizontal overflow, and the console reports no errors.
