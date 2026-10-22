import type { ReactNode } from 'react';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

export default function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={['flex flex-col items-center justify-center rounded-panel border border-line bg-surface px-6 py-10 text-center', className].join(' ')}>
      {icon === undefined ? null : (
        <span aria-hidden="true" className="mb-4 grid size-11 place-items-center rounded-full bg-signal-soft text-signal">
          {icon}
        </span>
      )}
      <h3 className="font-display text-[1.25rem] font-bold tracking-[-0.02em] text-ink">{title}</h3>
      <p className="mt-2 max-w-[32ch] text-[0.8125rem] leading-[1.6] text-ink-2">{description}</p>
      {action === undefined ? null : <div className="mt-5">{action}</div>}
    </div>
  );
}
