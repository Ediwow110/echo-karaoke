import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastProps = {
  message: string;
  detail?: string;
  tone?: ToastTone;
  onDismiss: () => void;
  durationMs?: number;
  className?: string;
};

const EXIT_MS = 140;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const icons = {
  success: CheckCircleIcon,
  error: WarningCircleIcon,
  info: InfoIcon,
};

export default function Toast({
  message,
  detail,
  tone = 'success',
  onDismiss,
  durationMs = 5000,
  className = '',
}: ToastProps) {
  // Parent screens re-render on every poll and pass a fresh inline callback.
  // The timer must not restart or it never fires.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const exitTimerRef = useRef<number | undefined>(undefined);

  // Unmounting the moment dismiss fires cuts the toast off mid-read; hold it
  // for one short exit, then tell the parent to remove it.
  const beginDismiss = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    if (prefersReducedMotion()) {
      dismissRef.current();
      return;
    }
    exitTimerRef.current = window.setTimeout(() => dismissRef.current(), EXIT_MS);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(beginDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [beginDismiss, durationMs, message]);

  useEffect(() => () => {
    if (exitTimerRef.current !== undefined) window.clearTimeout(exitTimerRef.current);
  }, []);

  const Icon = icons[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={[
        'pointer-events-auto flex w-full max-w-[26rem] items-center gap-3 rounded-panel border px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.45)]',
        leaving ? 'animate-toast-out' : 'animate-toast-in',
        tone === 'error'
          ? 'border-danger/35 bg-danger-soft text-ink'
          : tone === 'success'
            ? 'border-signal/30 bg-signal-soft text-ink'
            : 'border-line bg-surface-2 text-ink',
        className,
      ].join(' ')}
    >
      <Icon size={20} weight="fill" className={tone === 'error' ? 'shrink-0 text-danger' : 'shrink-0 text-signal'} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-semibold leading-[1.4]">{message}</p>
        {detail === undefined ? null : <p className="mt-0.5 text-[0.6875rem] leading-[1.4] text-ink-2">{detail}</p>}
      </div>
      <button
        type="button"
        onClick={beginDismiss}
        aria-label="Dismiss message"
        className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-[background-color,color,transform,scale] active:scale-95 hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <XIcon size={14} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
