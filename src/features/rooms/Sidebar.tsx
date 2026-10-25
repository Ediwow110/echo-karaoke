import { Link, useLocation } from 'react-router-dom';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { CompassIcon } from '@phosphor-icons/react/dist/csr/Compass';
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart';
import { MusicNotesIcon } from '@phosphor-icons/react/dist/csr/MusicNotes';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { QueueIcon } from '@phosphor-icons/react/dist/csr/Queue';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { Avatar, Logo } from '../../ui';
import { getStoredProfileName } from './sessionStore';

export type SidebarNav =
  | 'discover'
  | 'library'
  | 'songbook'
  | 'queue'
  | 'favorites'
  | 'recent'
  | 'create'
  | 'settings';

export type ActiveRoom = {
  roomId: string;
  name: string;
  code: string;
  hostName: string;
};

type Props = {
  activeNav: SidebarNav;
  activeRoom?: ActiveRoom | null;
  hostName?: string;
};

type NavItem = {
  key: SidebarNav;
  label: string;
  href: string;
  icon: typeof CompassIcon;
  requiresRoom?: boolean;
};

const items: NavItem[] = [
  { key: 'discover', label: 'Discover', href: '/', icon: CompassIcon, requiresRoom: true },
  { key: 'library', label: 'Song library', href: '/library', icon: MusicNotesIcon },
  { key: 'songbook', label: 'Songbook', href: '/songbook', icon: MusicNotesIcon, requiresRoom: true },
  { key: 'queue', label: 'Room queue', href: '/queue', icon: QueueIcon, requiresRoom: true },
  { key: 'favorites', label: 'Favorites', href: '/favorites', icon: HeartIcon },
  { key: 'recent', label: 'Recently sung', href: '/recent', icon: ClockCounterClockwiseIcon },
  { key: 'create', label: 'Create room', href: '/', icon: PlusIcon },
  { key: 'settings', label: 'Room settings', href: '/settings', icon: SlidersHorizontalIcon, requiresRoom: true },
];

function hrefFor(item: NavItem, activeRoom: ActiveRoom | null | undefined): string {
  if (item.key === 'discover') {
    return activeRoom === null || activeRoom === undefined ? '/' : '/room/' + activeRoom.roomId + '/host';
  }
  if (item.key === 'queue') {
    return activeRoom === null || activeRoom === undefined ? '/' : '/room/' + activeRoom.roomId + '/host/queue';
  }
  if (item.key === 'settings') {
    return activeRoom === null || activeRoom === undefined ? '/' : '/room/' + activeRoom.roomId + '/host/settings';
  }
  if (item.key === 'songbook') {
    return activeRoom === null || activeRoom === undefined ? '/' : '/room/' + activeRoom.roomId + '/host/songbook';
  }
  if ((item.key === 'library' || item.key === 'favorites' || item.key === 'recent')
    && activeRoom !== null && activeRoom !== undefined) {
    return '/room/' + activeRoom.roomId + '/host/' + item.key;
  }
  return item.href;
}

export default function Sidebar({ activeNav, activeRoom, hostName }: Props) {
  const location = useLocation();
  const name = hostName ?? getStoredProfileName() ?? '';
  const displayName = name.length > 0 ? name : 'Host';

  return (
    <aside aria-label="Room navigation" className="hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-graphite-deep px-4 pb-5 pt-7 lg:sticky lg:top-0 lg:flex">
      <Link to="/" className="px-2" aria-label="kara-echo, create a room">
        <Logo size="lg" />
      </Link>

      <nav aria-label="Primary" className="mt-9 mb-5 flex flex-col gap-1">
        {items.map((item) => {
          const disabled = item.requiresRoom === true && (activeRoom === null || activeRoom === undefined);
          const href = hrefFor(item, activeRoom);
          const active = activeNav === item.key
            || (item.key === 'discover' && location.pathname.endsWith('/host'))
            || (item.key === 'queue' && location.pathname.endsWith('/host/queue'))
            || (item.key === 'settings' && location.pathname.endsWith('/host/settings'))
            || (item.key === 'library' && location.pathname.endsWith('/host/library'))
            || (item.key === 'songbook' && location.pathname.endsWith('/host/songbook'))
            || (item.key === 'favorites' && (location.pathname.endsWith('/host/favorites') || location.pathname === '/favorites'))
            || (item.key === 'recent' && (location.pathname.endsWith('/host/recent') || location.pathname === '/recent'))
            || (item.key === 'library' && location.pathname === '/library');
          const Icon = item.icon;
          if (disabled) {
            return (
              <span
                key={item.key}
                aria-disabled="true"
                title="Create a room first"
                className="flex min-h-10 cursor-not-allowed items-center gap-3 rounded-badge px-3 text-[0.75rem] text-ink-3 opacity-45"
              >
                <Icon size={17} weight="regular" aria-hidden="true" />
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.key}
              to={href}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex min-h-10 items-center gap-3 rounded-badge px-3 text-[0.75rem] font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                active
                  ? 'bg-signal-soft text-signal'
                  : 'text-ink-2 hover:bg-surface hover:text-ink',
              ].join(' ')}
            >
              <Icon size={17} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-panel border border-line bg-surface p-4">
        {activeRoom === undefined || activeRoom === null ? (
          <>
            <p className="eyebrow text-gold">Your next session</p>
            <p className="mt-2 text-[0.6875rem] leading-[1.65] text-ink-2">
              One screen. A room full of voices.
            </p>
            <Link to="/" className="mt-2 inline-block text-[0.6875rem] text-signal hover:underline">
              Start something good.
            </Link>
          </>
        ) : (
          <>
            <p className="eyebrow truncate text-gold">{activeRoom.name}</p>
            <p className="mt-2 text-[0.6875rem] leading-[1.65] text-ink-2">
              You're hosting this room.
            </p>
            <Link
              to={'/room/' + activeRoom.roomId + '/host/settings'}
              className="mt-2 inline-block text-[0.6875rem] text-signal hover:underline"
            >
              Room settings
            </Link>
          </>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2.5 px-1">
        <Avatar name={displayName} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[0.75rem] font-medium text-ink">{displayName}</p>
          <p className="text-[0.625rem] text-ink-2">{activeRoom === null || activeRoom === undefined ? 'Host setup' : 'Host'}</p>
        </div>
      </div>
    </aside>
  );
}
