import { useEffect, useRef, useState, type ReactNode } from 'react';

export type PlayerChromeProps = {
  playing: boolean;
  title: string | null;
  channel: string | null;
  children: ReactNode;
};

const IDLE_AFTER_MS = 2600;

/**
 * The bar that sits over the bottom of the video frame.
 * It carries the song and the transport controls. While a song plays and the
 * host is still, the bar fades away. Any pointer movement brings it back, and
 * a keyboard user brings it back by tabbing into it, because focus always
 * reveals the bar.
 */
export default function PlayerChrome({ playing, title, channel, children }: PlayerChromeProps) {
  const [idle, setIdle] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (playing !== true) {
      setIdle(false);
      return;
    }

    let timer = 0;
    const hideLater = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    };
    const wake = (): void => {
      setIdle(false);
      hideLater();
    };

    // The picture sits in an iframe, which keeps the pointer to itself. The
    // bar under it stays clickable, so a host who moves toward the controls
    // wakes them, and a key press does the same.
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    hideLater();

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [playing]);

  const hidden = playing === true && idle === true;

  return (
    <div ref={rootRef} className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(10,11,14,0.94))] px-3 pb-3 pt-14 sm:px-4 sm:pb-4">
      <div
        data-controls
        className={[
          'flex items-end justify-between gap-3 transition-opacity duration-300',
          hidden === true ? 'pointer-events-none opacity-0' : 'opacity-100',
          'focus-within:pointer-events-auto focus-within:opacity-100',
        ].join(' ')}
      >
        <div className="hidden min-w-0 sm:block">
          {title === null ? null : (
            <p className="truncate font-display text-[0.9375rem] font-semibold text-ink">{title}</p>
          )}
          {channel === null ? null : (
            <p className="truncate text-[0.8125rem] text-ink-2">{channel}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
