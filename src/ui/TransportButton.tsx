import type { ReactNode } from 'react';

export type TransportButtonProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'surface' | 'primary' | 'ghost';
};

const sizes = {
  sm: 'size-9',
  md: 'size-11',
  lg: 'size-14',
};

export default function TransportButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
  size = 'md',
  tone = 'surface',
}: TransportButtonProps) {
  return (
    <span className="tooltip inline-flex" data-tooltip={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active === true ? true : undefined}
        className={[
          'grid place-items-center rounded-full transition-[background-color,border-color,color,transform,translate,scale] duration-(--duration-fast) ease-(--ease-console)',
          'active:scale-95 disabled:pointer-events-none disabled:opacity-35',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
          sizes[size],
          tone === 'primary'
            ? 'bg-signal-fill text-signal-ink hover:bg-signal-fill-hover'
            : tone === 'ghost'
              ? 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              : 'border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
          active ? 'border-signal/50 text-signal' : '',
        ].join(' ')}
      >
        <span aria-hidden="true" className="grid place-items-center">{icon}</span>
      </button>
    </span>
  );
}
