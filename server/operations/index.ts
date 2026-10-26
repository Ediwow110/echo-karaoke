import { requireAnonymousCaller } from '../auth/identity.js';
import { approveMember, rejectMember } from './admission.js';
import { catalogPage } from './catalogBrowse.js';
import { catalogSync } from './catalogSync.js';
import { claimHost, transferHost } from './transferHost.js';
import { createRoom } from './createRoom.js';
import { handleThrown, HttpError, jsonResponse, logFailure } from './errors.js';
import { queueCommand } from './queue.js';
import {
  hostCommand,
  joinRoom,
  playbackCommand,
  playbackReport,
  readRoomGuest,
  readRoomHost,
  removeRoomMember,
  touchMember,
  voteCommand,
} from './room.js';
import { youtubePopular, youtubeSearch, youtubeSuggest } from './youtube.js';

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
  'host-remove-member',
  'queue-command',
  'youtube-search',
  'youtube-suggest',
  'youtube-popular',
  'catalog-page',
  'catalog-sync',
  'transfer-host',
  'claim-host',
  'approve-member',
  'reject-member',
]);

function isAuthFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /a signed-in session is required|not a JWT|unexpected algorithm|carries no subject|only an anonymous identity|unknown key|signature does not verify|has expired/i.test(error.message);
}

export async function handleOperation(request: Request): Promise<Response> {
  const operation = new URL(request.url).pathname.replace(/^\/api\//, '');
  try {
    if (request.method !== 'POST') {
      throw new HttpError('METHOD_NOT_ALLOWED', 405, 'Use POST');
    }

    const name = operation;
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
      case 'host-remove-member':
        return await removeRoomMember(request, caller);
      case 'queue-command':
        return await queueCommand(request, caller);
      case 'youtube-search':
        return await youtubeSearch(request, caller);
      case 'youtube-suggest':
        return await youtubeSuggest(request, caller);
      case 'youtube-popular':
        return await youtubePopular(request, caller);
      case 'catalog-page':
        return await catalogPage(request, caller);
      case 'catalog-sync':
        return await catalogSync(request, caller);
      case 'transfer-host':
        return await transferHost(request, caller);
      case 'claim-host':
        return await claimHost(request, caller);
      case 'approve-member':
        return await approveMember(request, caller);
      case 'reject-member':
        return await rejectMember(request, caller);
      default:
        throw new HttpError('NOT_IMPLEMENTED', 501, 'That operation is not available');
    }
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status >= 500 || error.status === 401 || error.status === 403) {
        logFailure(operation, error, error.status, request);
      }
      return handleThrown(error);
    }
    if (isAuthFailure(error)) {
      logFailure(operation, error, 401, request);
      return jsonResponse(
        { error: { code: 'UNAUTHORIZED', message: 'A signed-in session is required' } },
        401,
      );
    }
    logFailure(operation, error, 500, request);
    return handleThrown(error);
  }
}
