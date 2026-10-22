import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createElement } from 'react';
import JoinRoomPage from '../../src/app/JoinRoomPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] };

function renderJoin(code = 'ABCDEFGHJKMNPQRS') {
  const path = code.length > 0 ? '/join/' + code : '/join';
  return render(
    createElement(RoomApiProvider, {
      api,
      children: createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(
          Routes,
          { children: [
            createElement(Route, { key: 'join', path: '/join', element: createElement(JoinRoomPage) }),
            createElement(Route, { key: 'code', path: '/join/:roomCode', element: createElement(JoinRoomPage) }),
          ] },
        ),
      ),
    }),
  );
}

describe('join screen', () => {
  it('names the room the guest is joining', () => {
    renderJoin();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/join the room/i);
    expect(screen.getByLabelText(/room code/i)).toHaveValue('ABCDEFGHJKMNPQRS');
  });

  it('asks for the guest name and offers the join action', () => {
    renderJoin();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
  });

  it('keeps the room code editable for a code typed by hand', () => {
    renderJoin('');
    expect(screen.getByLabelText(/room code/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /join room/i })).toBeDisabled();
  });
});
