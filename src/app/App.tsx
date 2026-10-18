import { BrowserRouter, Route, Routes } from 'react-router-dom';
import HomePage from './HomePage';
import JoinRoomPage from './JoinRoomPage';
import GuestRoomPage from './GuestRoomPage';
import HostRoomPage from './HostRoomPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/join/:roomCode" element={<JoinRoomPage />} />
        <Route path="/room/:roomId" element={<GuestRoomPage />} />
        <Route path="/room/:roomId/host" element={<HostRoomPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
