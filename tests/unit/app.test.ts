import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../src/app/App';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const unusedApi: EdgeApi = {
  invoke: (async () => {
    throw new Error('The home screen must not call the room service');
  }) as unknown as EdgeApi['invoke'],
};

function renderHome() {
  return render(
    createElement(RoomApiProvider, { api: unusedApi, children: createElement(App) }),
  );
}

describe('karaoke home screen', () => {
  it('offers clearly labeled room entry points', () => {
    renderHome();

    expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
  });

  it('asks for a display name and a room code', () => {
    renderHome();

    expect(screen.getByLabelText(/host name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/guest name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
  });
});
