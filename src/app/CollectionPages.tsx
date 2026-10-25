import { useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AppShell from '../features/rooms/AppShell';
import type { SidebarNav } from '../features/rooms/Sidebar';
import SongCollectionView, { type CollectionMode } from '../features/library/SongCollectionView';
import { getLastRoomSession } from '../features/rooms/sessionStore';
import { loadGuestToken, loadHostToken } from '../features/rooms/tokenStore';

function useLastRoomInfo() {
  return useMemo(() => getLastRoomSession(), []);
}

function GlobalCollection({ mode, activeNav }: { mode: CollectionMode; activeNav: SidebarNav }) {
  const last = useLastRoomInfo();
  const hostToken = last !== null && loadHostToken(last.roomId) !== null;
  const guestToken = last !== null && loadGuestToken(last.roomId) !== null;
  const roomId = last !== null && (hostToken || guestToken) ? last.roomId : null;
  const queueHref = roomId === null
    ? null
    : hostToken
      ? '/room/' + roomId + '/host/queue'
      : '/room/' + roomId;
  const searchHref = roomId === null
    ? null
    : hostToken
      ? '/room/' + roomId + '/host'
      : '/room/' + roomId + '/search';

  if (hostToken && last !== null) {
    return <Navigate to={'/room/' + last.roomId + '/host/' + mode} replace />;
  }

  return (
    <AppShell
      activeNav={activeNav}
      activeRoom={null}
      mobileAction={<Link to="/" className="text-[0.75rem] font-semibold text-signal">Create room</Link>}
    >
      <main className="page-enter mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 lg:px-8">
        <SongCollectionView
          mode={mode}
          roomId={roomId}
          queueHref={queueHref}
          searchHref={searchHref}
        />
      </main>
    </AppShell>
  );
}

export function LibraryPage() {
  return <GlobalCollection mode="library" activeNav="library" />;
}

export function FavoritesPage() {
  return <GlobalCollection mode="favorites" activeNav="favorites" />;
}

export function RecentPage() {
  return <GlobalCollection mode="recent" activeNav="recent" />;
}

export function LastRoomQueueRedirect() {
  const last = useLastRoomInfo();
  if (last === null) {
    return <Navigate to="/" replace />;
  }
  if (loadHostToken(last.roomId) !== null) {
    return <Navigate to={'/room/' + last.roomId + '/host/queue'} replace />;
  }
  if (loadGuestToken(last.roomId) !== null) {
    return <Navigate to={'/room/' + last.roomId} replace />;
  }
  return <Navigate to={'/join/' + last.code} replace />;
}

export function LastRoomSettingsRedirect() {
  const last = useLastRoomInfo();
  if (last !== null && loadHostToken(last.roomId) !== null) {
    return <Navigate to={'/room/' + last.roomId + '/host/settings'} replace />;
  }
  return <Navigate to="/" replace />;
}
