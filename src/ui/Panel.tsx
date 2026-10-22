import type { ReactNode } from 'react';

export type PanelProps = {
  title?: string;
  eyebrow?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export default function Panel({
  title,
  eyebrow,
  icon,
  action,
  children,
  className = '',
  bodyClassName = 'mt-4',
}: PanelProps) {
  return (
    <section className={['rounded-panel border border-line bg-surface', className].join(' ')}>
      {title === undefined && eyebrow === undefined && action === undefined ? null : (
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {eyebrow === undefined ? null : <p className="eyebrow text-ink-2">{eyebrow}</p>}
            {title === undefined ? null : (
              <h2 className="mt-1 flex items-center gap-2 font-display text-[1.125rem] font-bold tracking-[-0.01em] text-ink">
                {icon === undefined ? null : <span aria-hidden="true" className="text-signal">{icon}</span>}
                {title}
              </h2>
            )}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName + ' px-5 pb-5'}>{children}</div>
    </section>
  );
}
