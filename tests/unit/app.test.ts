import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
