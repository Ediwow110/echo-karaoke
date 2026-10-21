export type RosterRowProps = {
  name: string;
  online: boolean;
  isHost?: boolean;
};

export default function RosterRow({ name, online, isHost = false }: RosterRowProps) {
  return (
    <li className="flex items-center gap-2.5 rounded-full border border-line bg-surface-2 px-3 py-1.5">
      <span
        aria-hidden="true"
        className={['size-2 shrink-0 rounded-full', online === true ? 'animate-presence-pulse bg-live' : 'bg-ink-3'].join(' ')}
      />
      <span className="truncate text-[0.875rem] text-ink">{name}</span>
      {isHost === true ? (
        <span className="rounded-badge bg-signal-soft px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-signal">Host</span>
      ) : null}
      <span className="sr-only">{online === true ? 'Online' : 'Away'}</span>
    </li>
  );
}
