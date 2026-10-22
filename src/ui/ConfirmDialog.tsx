import { useEffect, useRef } from 'react';
import Button from './Button';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  cancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
    }, 20);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busyRef.current) {
        cancelRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-graphite-deep/75 px-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        className="w-full max-w-[26rem] rounded-panel border border-line bg-surface p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-console-in"
      >
        <h2 id="confirm-title" className="font-display text-[1.5rem] font-bold tracking-[-0.02em] text-ink">{title}</h2>
        <p id="confirm-description" className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button
            data-confirm="true"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            busy={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
