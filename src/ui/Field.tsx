import type { InputHTMLAttributes, ReactNode } from 'react';

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  icon?: ReactNode;
};

export default function Field({ id, label, hint, error, icon, className = '', ...rest }: FieldProps) {
  const invalid = typeof error === 'string' && error.length > 0;
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </label>
      <div className="relative mt-2">
        {icon === undefined ? null : (
          <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
            {icon}
          </span>
        )}
        <input
          {...rest}
          id={id}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={invalid === true ? id + '-error' : hint === undefined ? undefined : id + '-hint'}
          className={[
            'min-h-11 w-full rounded-panel border bg-surface-2 px-3.5 text-[0.9375rem] text-ink',
            'placeholder:text-ink-3',
            'transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-console)',
            'focus:outline-none focus-visible:outline-none',
            invalid === true ? 'border-danger focus:border-danger' : 'border-line focus:border-signal',
            icon === undefined ? '' : 'pl-10',
            className,
          ].join(' ')}
        />
      </div>
      {invalid === true ? (
        <p id={id + '-error'} role="alert" className="mt-2 text-[0.8125rem] text-danger">{error}</p>
      ) : hint === undefined ? null : (
        <p id={id + '-hint'} className="mt-2 text-[0.8125rem] text-ink-3">{hint}</p>
      )}
    </div>
  );
}
