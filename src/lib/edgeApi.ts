export type EdgeFunctionName =
  | 'create-room'
  | 'join-room'
  | 'guest-room-read'
  | 'host-room-read'
  | 'host-command'
  | 'queue-command'
  | 'youtube-search'
  | 'playback-command'
  | 'playback-report'
  | 'vote-command'
  | 'touch-member';

export type RoomTokens = {
  guestToken?: string;
  hostToken?: string;
};

export type EdgeApiConfig = {
  url: string;
  anonKey: string;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export class RoomApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'RoomApiError';
    this.code = code;
    this.status = status;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function parseError(status: number, payload: unknown): RoomApiError {
  const fallback = new RoomApiError('INTERNAL_ERROR', status, 'The request could not be completed');
  if (payload === null || typeof payload !== 'object') {
    return fallback;
  }
  const error = (payload as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') {
    return fallback;
  }
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return new RoomApiError(
    typeof code === 'string' ? code : 'INTERNAL_ERROR',
    status,
    typeof message === 'string' ? message : fallback.message,
  );
}

export type EdgeApi = {
  invoke: <T>(name: EdgeFunctionName, body: unknown, tokens?: RoomTokens) => Promise<T>;
};

export function createEdgeApi(config: EdgeApiConfig): EdgeApi {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = trimTrailingSlash(config.url);

  return {
    async invoke<T>(name: EdgeFunctionName, body: unknown, tokens: RoomTokens = {}): Promise<T> {
      const accessToken = await config.getAccessToken();
      if (accessToken === null || accessToken.length === 0) {
        throw new RoomApiError('NO_SESSION', 401, 'Sign in is required before joining a room');
      }

      const headers: Record<string, string> = {
        apikey: config.anonKey,
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      };
      if (tokens.guestToken !== undefined && tokens.guestToken.length > 0) {
        headers['x-room-guest-token'] = tokens.guestToken;
      }
      if (tokens.hostToken !== undefined && tokens.hostToken.length > 0) {
        headers['x-room-host-token'] = tokens.hostToken;
      }

      let response: Response;
      try {
        response = await doFetch(baseUrl + '/functions/v1/' + name, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        throw new RoomApiError('NETWORK_ERROR', 0, 'The room service could not be reached');
      }

      const text = await response.text();
      let payload: unknown = null;
      if (text.length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }

      if (!response.ok) {
        throw parseError(response.status, payload);
      }

      return payload as T;
    },
  };
}
