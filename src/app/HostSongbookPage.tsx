import SongbookList from '../features/catalog/SongbookList';
import { CATALOG_CHANNEL_LABELS } from '../features/catalog/catalogApi';
import { useRoomApi } from './RoomApiProvider';
import { useHostRoom } from './useHostRoom';

export default function HostSongbookPage() {
  const api = useRoomApi();
  const { roomId, refresh } = useHostRoom();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow text-gold">Powered by YouTube</p>
        <h2 className="mt-1 font-display text-[clamp(1.9rem,2.8vw,2.15rem)] font-bold leading-[1.08] tracking-[-0.03em] text-ink">
          Karaoke songbook
        </h2>
        <p className="mt-1 text-[0.8125rem] text-ink-2">With lyrics, ready to queue. Songs play from YouTube.</p>
      </div>
      <SongbookList api={api} roomId={roomId} channels={CATALOG_CHANNEL_LABELS} canSync onAdded={() => { void refresh(); }} />
    </div>
  );
}
