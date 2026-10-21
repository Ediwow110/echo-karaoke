import type { ReactNode } from 'react';

export type TransportButtonProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  shape?: 'dock' | 'bar';
};

export default function TransportButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
  shape = 'dock',
}: TransportButtonProps) {
  if (shape === 'bar') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={[
          'inline-flex min-h-10 items-center gap-2 rounded-panel border px-3.5 text-[0.8125rem] font-semibold',
          'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console)',
          'hover:-translate-y-px active:translate-y-0 active:scale-[0.98]',
          'disabled:pointer-events-none disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
          active === true
            ? 'border-signal bg-signal-soft text-signal'
            : 'border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
        ].join(' ')}
      >
        <span aria-hidden="true" className="grid place-items-center">{icon}</span>
        {label}
      </button>
    );
  }

  return (
    <span className="tooltip inline-flex" data-tooltip={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={[
          'grid size-14 place-items-center rounded-full border',
          'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console)',
          'hover:-translate-y-px active:translate-y-0 active:scale-95',
          'disabled:pointer-events-none disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
          active === true
            ? 'border-signal bg-signal-soft text-signal'
            : 'border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
        ].join(' ')}
      >
        <span aria-hidden="true" className="grid place-items-center">{icon}</span>
      </button>
    </span>
  );
}
