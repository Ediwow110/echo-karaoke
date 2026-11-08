import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from '../../src/features/rooms/AppShell';
import '@testing-library/jest-dom/vitest';

afterEach(cleanup);

describe('app shell header', () => {
  it('renders a supplied room header instead of the default mobile bar', () => {
    render(
      <MemoryRouter>
        <AppShell activeNav="queue" mobileAction={<span>Default action</span>} header={<header>Room header</header>}>
          <p>Panel</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByText('Room header')).toBeInTheDocument();
    expect(screen.queryByText('Default action')).toBeNull();
    expect(screen.getByText('Panel')).toBeInTheDocument();
  });

  it('keeps the default mobile bar for pages without a room header', () => {
    render(
      <MemoryRouter>
        <AppShell activeNav="library" mobileAction={<span>Default action</span>}>
          <p>Panel</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByText('Default action')).toBeInTheDocument();
  });
});
