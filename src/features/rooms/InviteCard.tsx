import { useState } from 'react';
import { CheckIcon, CopyIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { Button, Chip, QrCode } from '../../ui';
import { groupRoomCode } from '../../lib/format';

type Props = {
  roomName: string;
  code: string;
  hostName: string;
  joinUrl: string;
  guests: number;
  variant?: 'panel' | 'compact' | 'party';
  className?: string;
};

export default function InviteCard({
  roomName,
  code,
  hostName,
  joinUrl,
  guests,
  variant = 'panel',
  className = '',
}: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy(): Promise<void> {
    setError(null);
    try {
      if (navigator.clipboard === undefined) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setError('Copy is blocked here. Select the code or the link below.');
    }
  }

  if (variant === 'party') {
    return (
      <div className={['flex items-center gap-3 rounded-panel border border-white/15 bg-graphite-deep/70 p-3 backdrop-blur', className].join(' ')}>
        <QrCode value={joinUrl} label={'QR code to join ' + roomName} size={104} />
        <div className="min-w-0">
          <p className="eyebrow text-ink-2">Join the room</p>
          <p className="mt-1 font-display text-[1.05rem] font-bold tracking-[-0.01em] text-ink">{roomName}</p>
          <p className="mt-0.5 text-[0.625rem] text-ink-2">Hosted by {hostName}</p>
          <p className="mt-1 font-mono text-[0.6875rem] tracking-[0.08em] text-signal">{groupRoomCode(code)}</p>
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <section className={['rounded-panel border border-line bg-surface p-5', className].join(' ')} aria-label="Invite your people">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow text-ink-2">Room remote</p>
            <h2 className="mt-1 font-display text-[1.1rem] font-bold tracking-[-0.02em] text-ink">Scan to join.</h2>
          </div>
          <Chip tone={guests > 0 ? 'live' : 'default'}>{guests} in</Chip>
        </div>
        <div className="mt-4 flex flex-col items-center">
          <QrCode value={joinUrl} label={'QR code to join ' + roomName} size={132} />
          <p className="mt-3 text-center font-mono text-[0.6875rem] leading-[1.7] tracking-[0.06em] text-ink">{groupRoomCode(code)}</p>
          <p className="mt-1 text-center text-[0.625rem] text-ink-2">Hosted by {hostName}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            icon={copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
            onClick={() => void copy()}
          >
            {copied ? 'Link copied' : 'Copy join link'}
          </Button>
          {error === null ? null : (
            <div className="mt-2 text-center">
              <p role="alert" className="text-[0.6875rem] leading-[1.5] text-danger">{error}</p>
              <p className="mt-1 select-all break-all font-mono text-[0.5625rem] text-ink-2">{joinUrl}</p>
            </div>
          )}
        </div>
        <span role="status" className="sr-only">{copied ? 'Join link copied' : ''}</span>
      </section>
    );
  }

  return (
    <section className={['rounded-panel border border-line bg-surface p-5', className].join(' ')} aria-label="Invite your people">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-ink-2">Room remote</p>
          <h2 className="mt-1 font-display text-[1.2rem] font-bold tracking-[-0.02em] text-ink">Invite your people.</h2>
        </div>
        <Chip tone={guests > 0 ? 'live' : 'default'}>
          <UsersThreeIcon size={11} aria-hidden="true" />
          {guests} in
        </Chip>
      </div>

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <QrCode value={joinUrl} label={'QR code to join ' + roomName} size={156} className="shrink-0" />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="font-mono text-[0.8125rem] leading-[1.7] tracking-[0.08em] text-ink">{groupRoomCode(code)}</p>
          <p className="mt-2 text-[0.6875rem] leading-[1.6] text-ink-2">
            Scan to join {roomName} and open the phone remote. No account or app needed.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            icon={copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
            onClick={() => void copy()}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </Button>
          {error === null ? null : (
            <div className="mt-2">
              <p role="alert" className="text-[0.6875rem] leading-[1.5] text-danger">{error}</p>
              <p className="mt-1 select-all break-all font-mono text-[0.625rem] text-ink-2">{joinUrl}</p>
            </div>
          )}
          <p className="mt-3 text-[0.625rem] leading-[1.5] text-ink-3">
            The code stays live until the host ends the room.
          </p>
        </div>
      </div>
      <span role="status" className="sr-only">{copied ? 'Join link copied' : ''}</span>
    </section>
  );
}
