import type { EdgeApi } from '../../lib/edgeApi';
import { loadGuestToken } from '../rooms/tokenStore';

export type VoteResult = {
  songId: string;
  voteCount: number;
  votedByViewer: boolean;
};

export async function toggleVote(
  api: EdgeApi,
  roomId: string,
  songId: string,
): Promise<VoteResult> {
  const guestToken = loadGuestToken(roomId);
  if (guestToken === null) {
    throw new Error('This browser has no guest pass for the room.');
  }
  return api.invoke<VoteResult>('vote-command', { roomId, songId }, { guestToken });
}
