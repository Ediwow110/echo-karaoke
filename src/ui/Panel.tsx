import type { ReactNode } from 'react';

export type PanelProps = {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function Panel({ title, icon, action, children, className = '' }: PanelProps) {
  return (
    <section className={['rounded-panel border border-line bg-surface p-6', className].join(' ')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[0.9375rem] font-semibold tracking-tight text-ink">
          {icon === undefined ? null : <span aria-hidden="true" className="text-signal">{icon}</span>}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
