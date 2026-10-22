type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  busy?: boolean;
};

export default function Toggle({ checked, onChange, label, description, disabled = false, busy = false }: Props) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="text-[0.875rem] font-semibold leading-[1.35] text-ink">{label}</p>
        {description === undefined ? null : (
          <p className="mt-1 text-[0.75rem] leading-[1.55] text-ink-2">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <span aria-hidden="true" className={['text-[0.625rem] font-medium', checked ? 'text-signal' : 'text-ink-2'].join(' ')}>
          {checked ? 'ON' : 'OFF'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled || busy}
          onClick={() => onChange(!checked)}
          className={[
            'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-(--duration-fast)',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            'disabled:pointer-events-none disabled:opacity-40',
            checked ? 'bg-signal-fill' : 'bg-line-strong',
          ].join(' ')}
        >
          <span
            aria-hidden="true"
            className={[
              'absolute top-1 size-4 rounded-full bg-graphite-deep transition-transform duration-(--duration-fast)',
              checked ? 'translate-x-6 bg-signal-ink' : 'translate-x-1',
            ].join(' ')}
          />
        </button>
      </div>
    </div>
  );
}
