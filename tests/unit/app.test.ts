import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/app/App';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const unusedApi: EdgeApi = {
  invoke: (async () => {
    throw new Error('The home screen must not call the room service');
  }) as unknown as EdgeApi['invoke'],
};

beforeEach(() => {
  window.history.pushState({}, '', '/');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function renderHome() {
  return render(
    createElement(RoomApiProvider, { api: unusedApi, children: createElement(App) }),
  );
}

describe('karaoke home screen', () => {
  it('offers a clearly labeled way into a room', () => {
    renderHome();

    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hosting tonight/i })).toBeInTheDocument();
  });

  it('asks for a display name and a room code, and can switch to hosting', () => {
    renderHome();

    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /hosting tonight/i }));
    expect(screen.getByLabelText(/room name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create room$/i })).toBeInTheDocument();
  });

  it('answers the create route with the create form, not the join form', () => {
    window.history.pushState({}, '', '/create');
    renderHome();

    expect(screen.getByLabelText(/room name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create room$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
  });

  it('opens the create form when the landing page hands over to the create route', async () => {
    // React Router reuses a route element when only the path changes, so the
    // landing page's join-first mode would otherwise follow the host to the
    // create route and answer it with the phone join screen.
    renderHome();
    expect(screen.getByRole('heading', { name: /join the room/i })).toBeInTheDocument();

    window.history.pushState({}, '', '/create');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => {
      expect(screen.getByLabelText(/room name/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
  });
});
