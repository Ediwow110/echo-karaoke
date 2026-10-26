import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../../src/features/rooms/Sidebar';
import type { SidebarNav } from '../../src/features/rooms/Sidebar';
import '@testing-library/jest-dom/vitest';

const roomOnly = ['Discover', 'Songbook', 'Room queue', 'Room settings'];
const always = ['Song library', 'Favorites', 'Recently sung'];

function renderSidebar(props: { activeNav?: SidebarNav; roomId?: string } = {}) {
  const { activeNav = 'create', roomId } = props;
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar
        activeNav={activeNav}
        activeRoom={roomId === undefined ? null : { roomId, name: 'After Hours', code: 'ABCDEFGHJKMNPQRS', hostName: 'Rafa' }}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// The sidebar carries a room card and an identity block below the nav, and the
// room card links to Room settings too, so every assertion stays inside the nav.
function nav() {
  return within(screen.getByRole('navigation', { name: 'Primary' }));
}

describe('the nav before a room exists', () => {
  it('offers the one action that works, and no greyed-out placeholders', () => {
    renderSidebar();
    expect(nav().getByRole('link', { name: 'Create room' })).toBeInTheDocument();
    for (const label of [...roomOnly, ...always]) {
      expect(nav().queryByRole('link', { name: label })).toBeNull();
      expect(nav().queryByText(label)).toBeNull();
    }
  });

  it('still names the page a visitor is standing on', () => {
    // The collection pages answer a typed URL or bookmark with no room in hand,
    // and a nav that hides the page you are reading is worse than a short one.
    renderSidebar({ activeNav: 'library' });
    expect(nav().getByText('Song library')).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Create room' })).toBeInTheDocument();
    expect(nav().queryByText('Favorites')).toBeNull();
    expect(nav().queryByText('Room queue')).toBeNull();
  });

  it('sends the session card to the create form as well', () => {
    // "Start something good." is the sidebar's other create action. The
    // landing page opens in join mode on a narrow screen, so a create action
    // has to land on the route that shows the form.
    renderSidebar();
    expect(screen.getByRole('link', { name: /start something good/i })).toHaveAttribute('href', '/create');
  });

  it('names the logo for where it goes', () => {
    // The logo goes home. A name that promises "create a room" sends a screen
    // reader to the join-first landing page and promises something the
    // destination cannot do.
    renderSidebar();
    expect(screen.getByRole('link', { name: 'kara-echo home' })).toHaveAttribute('href', '/');
  });
});

describe('the nav once a room exists', () => {
  it('opens up to every destination', () => {
    renderSidebar({ roomId: '550e8400-e29b-41d4-a716-446655440000' });
    for (const label of [...roomOnly, ...always, 'Create room']) {
      expect(nav().getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(nav().queryAllByRole('link', { name: 'Room queue' })).toHaveLength(1);
  });

  it('sends the create action to the create form, not the landing page', () => {
    // The landing page opens in join mode on a narrow screen, so an action
    // named "Create room" has to land on the route that shows the form.
    renderSidebar({ roomId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(nav().getByRole('link', { name: 'Create room' })).toHaveAttribute('href', '/create');
  });
});
