import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import HomePage from './HomePage';

// The landing screen stays in the entry bundle because it carries the
// largest contentful paint. Every other screen loads on demand, which keeps
// the YouTube player and the QR encoder out of a guest's first download.
const JoinRoomPage = lazy(() => import('./JoinRoomPage'));
const GuestRoomPage = lazy(() => import('./GuestRoomPage'));
const HostRoomPage = lazy(() => import('./HostRoomPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <main className="min-h-dvh bg-graphite px-4 py-6 text-ink">
            <div className="skeleton h-14 w-full rounded-panel" />
            <div className="skeleton mt-4 h-64 w-full rounded-panel" />
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join/:roomCode" element={<JoinRoomPage />} />
          <Route path="/room/:roomId" element={<GuestRoomPage />} />
          <Route path="/room/:roomId/host" element={<HostRoomPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
