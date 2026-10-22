import type { InputHTMLAttributes, ReactNode } from 'react';

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  icon?: ReactNode;
  action?: ReactNode;
  hideLabel?: boolean;
};

export default function Field({
  id,
  label,
  hint,
  error,
  icon,
  action,
  hideLabel = false,
  className = '',
  ...rest
}: FieldProps) {
  const invalid = typeof error === 'string' && error.length > 0;
  return (
    <div>
      <div className={hideLabel ? 'sr-only' : 'flex min-h-5 items-center justify-between gap-3'}>
        <label htmlFor={id} className="text-[0.75rem] font-semibold text-ink">{label}</label>
        {action}
      </div>
      <div className={hideLabel ? 'relative' : 'relative mt-2'}>
        {icon === undefined ? null : (
          <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-2">
            {icon}
          </span>
        )}
        <input
          {...rest}
          id={id}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={invalid ? id + '-error' : hint === undefined ? undefined : id + '-hint'}
          className={[
            'min-h-11 w-full rounded-media border bg-surface px-3.5 text-[0.875rem] text-ink',
            'placeholder:text-ink-3',
            'transition-[border-color,background-color] duration-(--duration-fast) ease-(--ease-console)',
            'focus:border-signal focus:outline-none focus-visible:outline-none',
            invalid ? 'border-danger' : 'border-line hover:border-line-strong',
            icon === undefined ? '' : 'pl-10',
            className,
          ].join(' ')}
        />
      </div>
      {invalid ? (
        <p id={id + '-error'} role="alert" className="mt-2 text-[0.75rem] text-danger">{error}</p>
      ) : hint === undefined ? null : (
        <p id={id + '-hint'} className="mt-2 text-[0.6875rem] leading-[1.5] text-ink-2">{hint}</p>
      )}
    </div>
  );
}
