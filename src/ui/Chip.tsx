import type { ReactNode } from 'react';

export type ChipTone = 'default' | 'signal' | 'live' | 'gold' | 'danger' | 'dark' | 'overlay';

export type ChipProps = {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
};

const tones: Record<ChipTone, string> = {
  default: 'border-line bg-surface-2 text-ink-2',
  signal: 'border-signal/25 bg-signal-soft text-signal',
  live: 'border-live/25 bg-live/10 text-live',
  gold: 'border-gold/25 bg-gold/10 text-gold',
  danger: 'border-danger/25 bg-danger-soft text-danger',
  dark: 'border-transparent bg-graphite-deep/70 text-ink-2',
  overlay: 'border-white/15 bg-graphite-deep/80 text-ink backdrop-blur',
};

export default function Chip({ children, tone = 'default', className = '' }: ChipProps) {
  return (
    <span className={[
      'inline-flex items-center gap-1.5 rounded-badge border px-2 py-1',
      'text-[0.625rem] font-semibold uppercase leading-none tracking-[0.06em]',
      tones[tone],
      className,
    ].join(' ')}>
      {children}
    </span>
  );
}
