import { describe, expect, it, vi } from 'vitest';
import type { EdgeApi } from '../../src/lib/edgeApi';
import { touchRoomMember } from '../../src/features/rooms/roomApi';
import { saveGuestToken, saveHostToken } from '../../src/features/rooms/tokenStore';

function apiWith(invoke: ReturnType<typeof vi.fn>): EdgeApi {
  return { invoke } as unknown as EdgeApi;
}

describe('room heartbeat', () => {
  it('sends the host pass for a host heartbeat', async () => {
    saveGuestToken('host-room-1', 'guest-pass');
    saveHostToken('host-room-1', 'host-pass');
    const invoke = vi.fn(async () => ({}));

    await touchRoomMember(apiWith(invoke), 'host-room-1', 'host');

    expect(invoke).toHaveBeenCalledWith(
      'touch-member',
      { roomId: 'host-room-1' },
      { hostToken: 'host-pass' },
    );
  });

  it('sends the guest pass for a guest heartbeat', async () => {
    saveGuestToken('guest-room-1', 'guest-pass');
    saveHostToken('guest-room-1', 'host-pass');
    const invoke = vi.fn(async () => ({}));

    await touchRoomMember(apiWith(invoke), 'guest-room-1', 'guest');

    expect(invoke).toHaveBeenCalledWith(
      'touch-member',
      { roomId: 'guest-room-1' },
      { guestToken: 'guest-pass' },
    );
  });

  it('does not heartbeat when the role pass is missing', async () => {
    saveGuestToken('host-room-2', 'guest-pass');
    const invoke = vi.fn(async () => ({}));

    await touchRoomMember(apiWith(invoke), 'host-room-2', 'host');

    expect(invoke).not.toHaveBeenCalled();
  });
});
