import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { RoomApiProvider } from './app/RoomApiProvider';
import { createEdgeApi } from './lib/edgeApi';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

const root = createRoot(rootElement);

/**
 * The auth module is only needed when the landing screen reaches the room
 * API, so it loads on demand instead of sitting in the entry chunk.
 */
async function accessToken(): Promise<string> {
  const { ensureAnonymousSession } = await import('./lib/auth');
  const token = await ensureAnonymousSession();
  cachedAccessToken = token;
  return token;
}

let cachedAccessToken: string | null = null;

function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

/**
 * Pulls the auth module in while the browser is idle so that joining a room
 * never waits on a second download. Visitors who leave straight away never
 * trigger it at all.
 */
function warmSessionBundle(): void {
  const start = (): void => {
    void import('./lib/auth').catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 3000 });
  } else {
    globalThis.setTimeout(start, 1200);
  }
}

const api = createEdgeApi({
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
