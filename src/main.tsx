import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { RoomApiProvider } from './app/RoomApiProvider';
import { createEdgeApi } from './lib/edgeApi';
import { readPublicConfig } from './lib/publicConfig';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

const root = createRoot(rootElement);
const env = import.meta.env as unknown as Record<string, string | undefined>;

/**
 * The database client is the single heaviest dependency in the app and the
 * landing screen never talks to it, so it loads on demand instead of sitting
 * in the entry chunk that every visitor downloads first.
 */
async function accessToken(): Promise<string> {
  const { ensureAnonymousSession, getSupabaseClient } = await import('./lib/supabase');
  const token = await ensureAnonymousSession(getSupabaseClient(env));
  cachedAccessToken = token;
  return token;
}

let cachedAccessToken: string | null = null;

function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

/**
 * Pulls the session bundle in while the browser is idle so that joining a
 * room never waits on a second download. Visitors who leave straight away
 * never trigger it at all.
 */
function warmSessionBundle(): void {
  const start = (): void => {
    void import('./lib/supabase').catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 3000 });
  } else {
    globalThis.setTimeout(start, 1200);
  }
}

try {
  const config = readPublicConfig(env);
  const api = createEdgeApi({
    url: config.url,
    anonKey: config.anonKey,
    getAccessToken: accessToken,
    getCachedAccessToken,
  });

  root.render(
    <StrictMode>
      <RoomApiProvider api={api}>
        <App />
      </RoomApiProvider>
    </StrictMode>,
  );

  warmSessionBundle();
} catch (error) {
  root.render(
    <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
      <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Encore needs configuration</h1>
        <p className="mt-3 text-[0.875rem] text-ink-2">
          {error instanceof Error ? error.message : 'Supabase environment variables are missing.'}
        </p>
      </div>
    </main>,
  );
}
