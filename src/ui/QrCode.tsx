import { useEffect, useState } from 'react';

export type QrCodeProps = {
  value: string;
  label: string;
  size?: number;
  className?: string;
};

type QrState = { src: string | null; failed: boolean };

/**
 * Renders a real scannable QR for the join URL. The encoder is loaded on
 * demand, so guests never download it.
 */
export default function QrCode({ value, label, size = 168, className = '' }: QrCodeProps) {
  const [state, setState] = useState<QrState>({ src: null, failed: false });

  useEffect(() => {
    if (value.length === 0) {
      setState({ src: null, failed: false });
      return;
    }
    let cancelled = false;
    setState({ src: null, failed: false });

    void import('qrcode')
      .then((module) => module.default.toDataURL(value, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: Math.max(size * 2, 512),
        color: { dark: '#100d18', light: '#ffffff' },
      }))
      .then((src) => {
        if (!cancelled) {
          setState({ src, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ src: null, failed: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [size, value]);

  if (state.failed) {
    return (
      <div
        className={['grid aspect-square w-full place-items-center rounded-media border border-line bg-surface-2 text-center', className].join(' ')}
        style={{ maxWidth: size }}
      >
        <span className="px-3 text-[0.6875rem] leading-[1.5] text-ink-2">
          The QR could not be drawn. Use the room code instead.
        </span>
      </div>
    );
  }

  if (state.src === null) {
    return (
      <div
        aria-label="Drawing the room QR code"
        className={['skeleton aspect-square w-full rounded-media', className].join(' ')}
        style={{ maxWidth: size }}
      >
        <span className="sr-only">Drawing the room QR code</span>
      </div>
    );
  }

  return (
    <div
      className={['overflow-hidden rounded-media bg-white p-1.5', className].join(' ')}
      style={{ width: size, maxWidth: '100%' }}
    >
      <img
        src={state.src}
        alt={label}
        width={size * 2}
        height={size * 2}
        decoding="async"
        data-join-url={value}
        className="h-auto w-full"
      />
    </div>
  );
}
