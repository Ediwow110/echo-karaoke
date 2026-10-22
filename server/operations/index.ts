import { requireAnonymousCaller } from '../auth/identity';
import { createRoom } from './createRoom';
import { handleThrown, HttpError, jsonResponse } from './errors';
import { queueCommand } from './queue';
import {
  hostCommand,
  joinRoom,
  playbackCommand,
  playbackReport,
  readRoomGuest,
  readRoomHost,
  touchMember,
  voteCommand,
} from './room';
import { youtubePopular, youtubeSearch, youtubeSuggest } from './youtube';

const OPERATIONS = new Set([
  'create-room',
  'join-room',
  'guest-room-read',
  'host-room-read',
  'touch-member',
  'vote-command',
  'playback-command',
  'playback-report',
  'host-command',
  'queue-command',
  'youtube-search',
  'youtube-suggest',
  'youtube-popular',
]);

function isAuthFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /a signed-in session is required|not a JWT|unexpected algorithm|carries no subject|only an anonymous identity|unknown key|signature does not verify|has expired/i.test(error.message);
}

export async function handleOperation(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      throw new HttpError('METHOD_NOT_ALLOWED', 405, 'Use POST');
    }

    const name = new URL(request.url).pathname.replace(/^\/api\//, '');
    if (!OPERATIONS.has(name)) {
      throw new HttpError('NOT_FOUND', 404, 'That operation is not available');
    }

    const caller = await requireAnonymousCaller(request);
    switch (name) {
      case 'create-room':
        return await createRoom(request, caller);
      case 'join-room':
        return await joinRoom(request, caller);
      case 'guest-room-read':
        return await readRoomGuest(request, caller);
      case 'host-room-read':
        return await readRoomHost(request, caller);
      case 'touch-member':
        return await touchMember(request, caller);
      case 'vote-command':
        return await voteCommand(request, caller);
      case 'playback-command':
        return await playbackCommand(request, caller);
      case 'playback-report':
        return await playbackReport(request, caller);
      case 'host-command':
        return await hostCommand(request, caller);
      case 'queue-command':
        return await queueCommand(request, caller);
      case 'youtube-search':
        return await youtubeSearch(request, caller);
      case 'youtube-suggest':
        return await youtubeSuggest(request, caller);
      case 'youtube-popular':
        return await youtubePopular(request, caller);
      default:
        throw new HttpError('NOT_IMPLEMENTED', 501, 'That operation is not available');
    }
  } catch (error) {
    if (error instanceof HttpError) return handleThrown(error);
    if (isAuthFailure(error)) {
      return jsonResponse(
        { error: { code: 'UNAUTHORIZED', message: 'A signed-in session is required' } },
        401,
      );
    }
    return handleThrown(error);
  }
}
