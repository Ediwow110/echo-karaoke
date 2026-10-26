import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import SongbookList from '../features/catalog/SongbookList';
import { CATALOG_CHANNEL_LABELS } from '../features/catalog/catalogApi';
import { useRoomApi } from './RoomApiProvider';

export default function GuestSongbook({ roomId, locked = false, onAdded }: {
  roomId: string;
  locked?: boolean;
  onAdded?: () => void;
}) {
  const api = useRoomApi();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link
          to={'/room/' + roomId + '/search'}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-media px-2 text-[0.75rem] font-semibold text-ink-2 hover:text-ink"
        >
          <ArrowLeftIcon size={15} aria-hidden="true" />
          Search
        </Link>
      </div>
      <div>
        <p className="eyebrow text-gold">Powered by YouTube</p>
        <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-ink">Karaoke songbook</h2>
        {/* Greyed-out controls with no reason read as a broken tab. The search
            screen already says this; the songbook has to say it too. */}
        {locked ? (
          <p role="status" className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
            The host turned off new requests.
          </p>
        ) : null}
      </div>
      <SongbookList api={api} roomId={roomId} channels={CATALOG_CHANNEL_LABELS} disabled={locked} onAdded={onAdded} />
    </div>
  );
}
