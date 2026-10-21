import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  busy?: boolean;
};

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-signal-fill text-white hover:bg-signal-fill-hover active:bg-signal-fill-press',
  secondary: 'border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-[0.8125rem]',
  md: 'min-h-11 px-4 text-[0.875rem]',
  lg: 'min-h-[3.25rem] px-5 text-[0.9375rem]',
};

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled === true || busy}
      aria-busy={busy}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-panel font-semibold',
        'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console)',
        'hover:-translate-y-px active:translate-y-0 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
        variants[variant],
        sizes[size],
        className,
      ].join(' ')}
    >
      {icon === undefined ? null : <span aria-hidden="true" className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
