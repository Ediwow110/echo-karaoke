import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { RoomApiProvider } from './app/RoomApiProvider';
import { createEdgeApi } from './lib/edgeApi';
import { ensureAnonymousSession, getSupabaseClient, readPublicConfig } from './lib/supabase';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

const root = createRoot(rootElement);
const env = import.meta.env as unknown as Record<string, string | undefined>;

try {
  const config = readPublicConfig(env);
  const supabase = getSupabaseClient(env);
  const api = createEdgeApi({
    url: config.url,
    anonKey: config.anonKey,
    getAccessToken: () => ensureAnonymousSession(supabase),
  });

  root.render(
    <StrictMode>
      <RoomApiProvider api={api}>
        <App />
      </RoomApiProvider>
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <main className="config-error">
      <h1>Encore needs configuration</h1>
      <p>{error instanceof Error ? error.message : 'Supabase environment variables are missing.'}</p>
    </main>,
  );
}
