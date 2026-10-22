import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  busy?: boolean;
  full?: boolean;
};

const variants: Record<ButtonVariant, string> = {
  primary: 'border border-transparent bg-signal-fill text-signal-ink hover:bg-signal-fill-hover active:bg-signal-fill-press',
  secondary: 'border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
  ghost: 'border border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
  quiet: 'border border-line bg-transparent text-ink hover:border-line-strong hover:bg-surface-2',
  danger: 'border border-danger/40 bg-danger-soft/40 text-danger hover:bg-danger-soft',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-[0.75rem]',
  md: 'min-h-10 px-4 text-[0.75rem]',
  lg: 'min-h-12 px-5 text-[0.8125rem]',
};

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  busy = false,
  full = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || busy}
      aria-busy={busy}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-media font-semibold tracking-[0.01em]',
        'transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-console)',
        'active:scale-[0.985]',
        'disabled:pointer-events-none disabled:opacity-45',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
        full === true ? 'w-full' : '',
        variants[variant],
        sizes[size],
        className,
      ].join(' ')}
    >
      {icon === undefined ? null : <span aria-hidden="true" className="shrink-0">{icon}</span>}
      {children}
      {iconAfter === undefined ? null : <span aria-hidden="true" className="shrink-0">{iconAfter}</span>}
    </button>
  );
}
