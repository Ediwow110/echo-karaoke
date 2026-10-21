import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  active?: boolean;
  tone?: 'default' | 'signal' | 'danger';
  size?: 'md' | 'lg';
  placement?: 'top' | 'bottom';
};

const tones = {
  default: 'border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
  signal: 'border border-signal/40 bg-signal-soft text-signal hover:bg-signal/20',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
} as const;

const sizes = {
  md: 'size-11',
  lg: 'size-14',
} as const;

export default function IconButton({
  icon,
  label,
  active = false,
  tone = 'default',
  size = 'md',
  placement = 'top',
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <span className={['tooltip inline-flex', placement === 'bottom' ? 'tooltip-below' : ''].join(' ')} data-tooltip={label}>
      <button
        {...rest}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={[
          'grid place-items-center rounded-full',
          'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console)',
          'hover:-translate-y-px active:translate-y-0 active:scale-95',
          'disabled:pointer-events-none disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
          active === true ? 'border border-signal bg-signal-soft text-signal' : tones[tone],
          sizes[size],
          className,
        ].join(' ')}
      >
        <span aria-hidden="true" className="grid place-items-center">{icon}</span>
      </button>
    </span>
  );
}
