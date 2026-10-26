import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import WaitingRoom from '../../src/app/WaitingRoom';
import '@testing-library/jest-dom/vitest';

afterEach(cleanup);

describe('the waiting room', () => {
  it('names the host who has to let you in, and shows nothing from the room', async () => {
    // The server sends this payload instead of the room; the screen only renders it.
    const { container } = render(<WaitingRoom hostName="Rafa" roomName="Living Room TV" />);
    expect(screen.getByText(/living room tv/i)).toBeInTheDocument();
    expect(screen.getByText(/rafa needs to let you in/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/queue|song|now playing/i);
  });

  it('is announced as a status, so a screen reader says it changed', () => {
    render(<WaitingRoom hostName="Rafa" roomName="Living Room TV" />);
    expect(screen.getByRole('status')).toHaveTextContent(/rafa needs to let you in/i);
  });
});
