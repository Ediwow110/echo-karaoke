import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import JoinRoomPage from '../../src/app/JoinRoomPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

const api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] };

function renderJoin(code = 'ABCDEFGHJKMNPQRS') {
  return render(
    createElement(
      RoomApiProvider,
      { api },
      createElement(
        MemoryRouter,
        { initialEntries: ['/join/' + code] },
        createElement(
          Routes,
          { children: createElement(Route, { path: '/join/:roomCode', element: createElement(JoinRoomPage) }) },
        ),
      ),
    ),
  );
}

describe('join screen', () => {
  it('names the room the guest is joining', () => {
    renderJoin();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/join the room/i);
    expect(screen.getByText('ABCDEFGHJKMNPQRS')).toBeInTheDocument();
  });

  it('asks for the guest name and offers the join action', () => {
    renderJoin();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join a room/i })).toBeInTheDocument();
  });

  it('keeps the room code visible', () => {
    renderJoin();
    expect(screen.getByLabelText(/room code/i)).toHaveValue('ABCDEFGHJKMNPQRS');
  });
});
