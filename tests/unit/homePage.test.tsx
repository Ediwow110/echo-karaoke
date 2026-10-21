import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../../src/app/HomePage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

const api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] };

function renderHome() {
  return render(
    createElement(
      RoomApiProvider,
      { api, children: createElement(MemoryRouter, { children: createElement(HomePage) }) },
    ),
  );
}

describe('landing page', () => {
  it('states what the product does', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/one room/i);
  });

  it('offers both ways in with an icon and a word', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /start a room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join a room/i })).toBeInTheDocument();
  });

  it('asks for a host name and a room code', () => {
    renderHome();
    expect(screen.getByLabelText(/host name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/guest name/i)).toBeInTheDocument();
  });

  it('shows the hero photograph with a description', () => {
    renderHome();
    const image = screen.getByRole('img', { name: /microphone/i });
    expect(image).toHaveAttribute('src', '/images/hero-microphone.jpg');
  });

  it('explains the three steps with icons and words', () => {
    renderHome();
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Invite')).toBeInTheDocument();
    expect(screen.getByText('Sing')).toBeInTheDocument();
  });

  it('leads a phone with joining and a wide screen with starting a room', () => {
    const { container } = renderHome();
    const cards = [...container.querySelectorAll('[data-start-card], [data-join-card]')];
    expect(cards.map((card) => card.getAttribute('data-start-card') !== null ? 'start' : 'join')).toEqual(['join', 'start']);
  });

  it('puts the start card first on a wide screen', () => {
    const wide = vi.fn().mockReturnValue({ matches: true, addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('matchMedia', wide);
    const { container } = renderHome();
    const cards = [...container.querySelectorAll('[data-start-card], [data-join-card]')];
    expect(cards.map((card) => card.getAttribute('data-start-card') !== null ? 'start' : 'join')).toEqual(['start', 'join']);
    vi.unstubAllGlobals();
  });

  it('tells a wide screen that it plays the music', () => {
    const wide = vi.fn().mockReturnValue({ matches: true, addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('matchMedia', wide);
    renderHome();
    expect(screen.getByText(/this screen plays the music/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
