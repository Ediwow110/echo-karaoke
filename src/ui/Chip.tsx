import type { ReactNode } from 'react';

export type ChipProps = {
  children: ReactNode;
  tone?: 'default' | 'live' | 'signal';
};

const tones = {
  default: 'border-line bg-surface-2 text-ink-2',
  live: 'border-live/30 bg-live/10 text-live',
  signal: 'border-signal/30 bg-signal-soft text-signal',
} as const;

export default function Chip({ children, tone = 'default' }: ChipProps) {
  return (
    <span className={['inline-flex items-center gap-1.5 rounded-badge border px-2.5 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.12em]', tones[tone]].join(' ')}>
      {children}
    </span>
  );
}
