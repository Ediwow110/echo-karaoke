import { Button } from '../../ui';
import type { DoorEntry } from './roomApi';

type Props = {
  door: DoorEntry[];
  busyId: string | null;
  onApprove: (memberId: string) => void;
  onReject: (memberId: string) => void;
};

export default function DoorList({ door, busyId, onApprove, onReject }: Props) {
  if (door.length === 0) {
    return <p className="text-[0.75rem] text-ink-2">Nobody is waiting at the door.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {door.map((entry) => (
        <li key={entry.memberId} className="flex flex-wrap items-center justify-between gap-3 rounded-badge border border-line bg-surface px-3 py-2">
          <span className="text-[0.8125rem] text-ink">{entry.displayName}</span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              busy={busyId === entry.memberId}
              onClick={() => onApprove(entry.memberId)}
            >
              Let {entry.displayName} in
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={busyId === entry.memberId}
              onClick={() => onReject(entry.memberId)}
            >
              Keep them out
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
