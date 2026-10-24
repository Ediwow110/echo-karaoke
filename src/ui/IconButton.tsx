import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  active?: boolean;
  toggle?: boolean;
  tone?: 'default' | 'signal' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  placement?: 'top' | 'bottom';
  tooltip?: boolean;
};

const tones = {
  default: 'border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
  signal: 'border border-signal/40 bg-signal-soft text-signal hover:bg-signal/20',
  danger: 'border border-danger/35 text-danger hover:bg-danger-soft',
  ghost: 'border border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
} as const;

const sizes = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-14',
} as const;

export default function IconButton({
  icon,
  label,
  active = false,
  toggle = false,
  tone = 'default',
  size = 'md',
  placement = 'top',
  tooltip = true,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      {...rest}
      type={type}
      aria-label={label}
      aria-pressed={toggle === true ? active : undefined}
      className={[
        'grid shrink-0 place-items-center rounded-full',
        'transition-[background-color,border-color,color,transform,translate,scale] duration-(--duration-fast) ease-(--ease-console)',
        'active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
        active === true ? 'border border-signal bg-signal-soft text-signal' : tones[tone],
        sizes[size],
        className,
      ].join(' ')}
    >
      <span aria-hidden="true" className="grid place-items-center">{icon}</span>
    </button>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <span className={['tooltip inline-flex', placement === 'bottom' ? 'tooltip-below' : ''].join(' ')} data-tooltip={label}>
      {button}
    </span>
  );
}
