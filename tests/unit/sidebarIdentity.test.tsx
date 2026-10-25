import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../../src/features/rooms/Sidebar';
import '@testing-library/jest-dom/vitest';

function renderSidebar(props: { hostName?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar activeNav="create" hostName={props.hostName} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the sidebar identity', () => {
  it('names nobody the visitor did not type in this session', () => {
    // A shared TV or laptop should not open by announcing whoever last used it.
    localStorage.setItem('karaoke.profile.name', 'Qoder');
    renderSidebar();
    expect(screen.queryByText('Qoder')).toBeNull();
    expect(screen.getByText('Host', { exact: true })).toBeInTheDocument();
  });

  it('shows the name it is handed', () => {
    renderSidebar({ hostName: 'Rafa' });
    expect(screen.getByText('Rafa')).toBeInTheDocument();
  });

  it('treats a blank name as no name rather than reaching for storage', () => {
    localStorage.setItem('karaoke.profile.name', 'Qoder');
    renderSidebar({ hostName: '' });
    expect(screen.getByText('Host', { exact: true })).toBeInTheDocument();
  });
});
