import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InviteCard from '../../src/features/rooms/InviteCard';
import '@testing-library/jest-dom/vitest';

const props = {
  roomName: 'Evening Karaoke',
  code: 'ABCDEFGHJKMNPQRS',
  hostName: 'Host',
  joinUrl: 'https://kara-echo.example/join/ABCDEFGHJKMNPQRS',
  guests: 2,
};

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalClipboard !== undefined) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function stubClipboard(writeText: (url: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: vi.fn(writeText) },
  });
}

describe('host QR invitation safety', () => {
  it('resets the copied confirmation when the live URL is replaced', async () => {
    const write = vi.fn(async () => undefined);
    stubClipboard(write);
    const { rerender } = render(<InviteCard {...props} shareReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument();
    rerender(<InviteCard {...props} shareReady joinUrl="https://kara-echo.example/join/DIFFERENTCODE123" />);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(write).toHaveBeenLastCalledWith('https://kara-echo.example/join/DIFFERENTCODE123');
  });

  it('never reports a delayed copy as successful after disconnect and reconnect', async () => {
    let resolveCopy: (() => void) | undefined;
    stubClipboard(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    const { rerender } = render(<InviteCard {...props} shareReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    rerender(<InviteCard {...props} shareReady={false} />);
    expect(screen.getByRole('status')).toHaveTextContent(/cannot verify this room/i);
    await act(async () => { resolveCopy?.(); });
    rerender(<InviteCard {...props} shareReady />);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link copied' })).not.toBeInTheDocument();
  });

  it('offers a selectable current link rather than a false success when clipboard access fails', async () => {
    stubClipboard(async () => { throw new Error('clipboard denied'); });
    render(<InviteCard {...props} shareReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/copy is blocked here/i);
    expect(screen.getByText(props.joinUrl)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link copied' })).not.toBeInTheDocument();
  });
  it('keeps the verified live invitation available', () => {
    render(<InviteCard {...props} shareReady />);
    expect(screen.getByRole('region', { name: 'Invite your people' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled();
    expect(screen.getByText(/ABCD EFGH JKMN PQRS/)).toBeInTheDocument();
  });

  it('does not show a scannable join invitation when the connection is offline', () => {
    render(<InviteCard {...props} shareReady={false} />);
    expect(screen.getByRole('region', { name: 'Invite your people' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/cannot verify this room/i);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/ABCD EFGH JKMN PQRS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2 in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/QR code to join/)).not.toBeInTheDocument();
  });

  it.each(['compact', 'party'] as const)(
    'suppresses the %s room QR while the host is offline',
    (variant) => {
      render(<InviteCard {...props} variant={variant} shareReady={false} />);
      expect(screen.getByRole('status')).toHaveTextContent(/cannot verify this room/i);
      expect(screen.queryByText(/ABCD EFGH JKMN PQRS/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
    },
  );
});
