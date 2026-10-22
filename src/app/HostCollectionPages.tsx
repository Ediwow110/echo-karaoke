import { useHostRoom } from './useHostRoom';
import SongCollectionView from '../features/library/SongCollectionView';

export function HostLibraryPage() {
  const { roomId, refresh } = useHostRoom();
  return (
    <SongCollectionView
      mode="library"
      roomId={roomId}
      queueHref={'/room/' + roomId + '/host/queue'}
      searchHref={'/room/' + roomId + '/host'}
      onAdded={() => { void refresh(); }}
    />
  );
}

export function HostFavoritesPage() {
  const { roomId, refresh } = useHostRoom();
  return (
    <SongCollectionView
      mode="favorites"
      roomId={roomId}
      queueHref={'/room/' + roomId + '/host/queue'}
      searchHref={'/room/' + roomId + '/host'}
      onAdded={() => { void refresh(); }}
    />
  );
}

export function HostRecentPage() {
  const { roomId, refresh } = useHostRoom();
  return (
    <SongCollectionView
      mode="recent"
      roomId={roomId}
      queueHref={'/room/' + roomId + '/host/queue'}
      searchHref={'/room/' + roomId + '/host'}
      onAdded={() => { void refresh(); }}
    />
  );
}
