import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../../ui';
import Sidebar, { type ActiveRoom, type SidebarNav } from './Sidebar';

type Props = {
  activeNav: SidebarNav;
  activeRoom?: ActiveRoom | null;
  hostName?: string;
  children: ReactNode;
  mobileAction?: ReactNode;
};

export default function AppShell({ activeNav, activeRoom, hostName, children, mobileAction }: Props) {
  return (
    <div className="min-h-dvh bg-graphite text-ink lg:flex">
      <Sidebar activeNav={activeNav} activeRoom={activeRoom} hostName={hostName} />
      <div className="min-w-0 flex-1">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-line px-4 lg:hidden">
          <Link to="/" aria-label="kara-echo, create a room">
            <Logo size="sm" />
          </Link>
          {mobileAction}
        </header>
        {children}
      </div>
    </div>
  );
}
