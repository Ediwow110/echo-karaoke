import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import HomePage from './HomePage';
import ErrorBoundary from '../ui/ErrorBoundary';

// The landing screen stays in the entry bundle because it carries the
// largest contentful paint. Every room screen loads on demand, which keeps
// the YouTube player and the QR encoder out of a guest's first download.
const JoinRoomPage = lazy(() => import('./JoinRoomPage'));
const GuestRoomPage = lazy(() => import('./GuestRoomPage'));
const HostRoomPage = lazy(() => import('./HostRoomPage'));
const HostDiscoverPage = lazy(() => import('./HostDiscoverPage'));
const HostQueuePage = lazy(() => import('./HostQueuePage'));
const HostSettingsPage = lazy(() => import('./HostSettingsPage'));
const HostStagePage = lazy(() => import('./HostStagePage'));
const HostPartyPage = lazy(() => import('./HostPartyPage'));
const HostSongbookPage = lazy(() => import('./HostSongbookPage'));
const ScanRoomPage = lazy(() => import('../features/scan/ScanRoomPage'));
const HostLibraryPage = lazy(() => import('./HostCollectionPages').then((module) => ({ default: module.HostLibraryPage })));
const HostFavoritesPage = lazy(() => import('./HostCollectionPages').then((module) => ({ default: module.HostFavoritesPage })));
const HostRecentPage = lazy(() => import('./HostCollectionPages').then((module) => ({ default: module.HostRecentPage })));
const LibraryPage = lazy(() => import('./CollectionPages').then((module) => ({ default: module.LibraryPage })));
const FavoritesPage = lazy(() => import('./CollectionPages').then((module) => ({ default: module.FavoritesPage })));
const RecentPage = lazy(() => import('./CollectionPages').then((module) => ({ default: module.RecentPage })));
const LastRoomQueueRedirect = lazy(() => import('./CollectionPages').then((module) => ({ default: module.LastRoomQueueRedirect })));
const LastRoomSettingsRedirect = lazy(() => import('./CollectionPages').then((module) => ({ default: module.LastRoomSettingsRedirect })));

// React Router reuses a route element when only its parameter changes. Keying
// the room screens by room id resets their state and tears down the old
// player when a saved session opens a different room.
function HostRoomRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  return <HostRoomPage key={roomId} />;
}

function GuestRoomRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  return <GuestRoomPage key={roomId} />;
}

// A route change should announce the new screen to keyboard and screen-reader
// users. Lazy routes can take a moment to render, so wait for their heading
// instead of focusing the loading skeleton that is about to disappear.
function RouteFocus() {
  const location = useLocation();
  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | null = null;
    let timer = 0;
    const focusHeading = (): boolean => {
      const heading = document.querySelector<HTMLElement>('main h1, main h2');
      if (heading === null) return false;
      heading.setAttribute('tabindex', '-1');
      heading.setAttribute('data-route-focus', 'true');
      heading.focus({ preventScroll: true });
      return true;
    };
    if (focusHeading()) {
      return () => undefined;
    }
    observer = new MutationObserver(() => {
      if (disposed) return;
      if (focusHeading()) {
        observer?.disconnect();
        observer = null;
        window.clearTimeout(timer);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = window.setTimeout(() => {
      observer?.disconnect();
      observer = null;
    }, 3000);
    return () => {
      disposed = true;
      observer?.disconnect();
      window.clearTimeout(timer);
    };
  }, [location.pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteFocus />
      <ErrorBoundary>
      <Suspense
        fallback={
          <main className="min-h-dvh bg-graphite px-4 py-6 text-ink sm:px-6">
            <span role="status" className="sr-only">Loading…</span>
            <div className="mx-auto max-w-[1240px]">
              <div className="skeleton h-12 w-48 rounded" />
              <div className="skeleton mt-5 h-60 w-full rounded-panel" />
              <div className="skeleton mt-4 h-40 w-full rounded-panel" />
            </div>
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join" element={<JoinRoomPage />} />
          <Route path="/join/:roomCode" element={<JoinRoomPage />} />
          <Route path="/scan" element={<ScanRoomPage />} />
          <Route path="/room/:roomId" element={<GuestRoomRoute />} />
          <Route path="/room/:roomId/search" element={<GuestRoomRoute />} />
          <Route path="/room/:roomId/songbook" element={<GuestRoomRoute />} />
          <Route path="/room/:roomId/host" element={<HostRoomRoute />}>
            <Route index element={<HostDiscoverPage />} />
            <Route path="queue" element={<HostQueuePage />} />
            <Route path="settings" element={<HostSettingsPage />} />
            <Route path="library" element={<HostLibraryPage />} />
            <Route path="favorites" element={<HostFavoritesPage />} />
            <Route path="recent" element={<HostRecentPage />} />
            <Route path="songbook" element={<HostSongbookPage />} />
            <Route path="stage" element={<HostStagePage />} />
            <Route path="party" element={<HostPartyPage />} />
          </Route>
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/recent" element={<RecentPage />} />
          <Route path="/queue" element={<LastRoomQueueRedirect />} />
          <Route path="/settings" element={<LastRoomSettingsRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
