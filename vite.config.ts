import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The dev server refuses unknown host names so that a page cannot point a
// browser at the local server through a rebound domain. A tunnel needs its
// host name allowed, and a tunnel host name changes on every run, so the
// allowance is opt in:
//   VITE_DEV_ALLOWED_HOSTS=.trycloudflare.com npm run dev
const allowedHosts = (process.env.VITE_DEV_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

// A tunnel serves the app over https, and a browser refuses an http request
// from an https page. The proxy answers the room service on the same origin
// as the app, so a tunnel carries the app and the service together:
//   VITE_DEV_SUPABASE_URL=http://127.0.0.1:55421
const supabaseTarget = process.env.VITE_DEV_SUPABASE_URL ?? '';

const proxy = supabaseTarget.length > 0
  ? {
      '/auth/v1': { target: supabaseTarget, changeOrigin: true },
      '/rest/v1': { target: supabaseTarget, changeOrigin: true },
      '/functions/v1': { target: supabaseTarget, changeOrigin: true },
      '/realtime/v1': { target: supabaseTarget, changeOrigin: true, ws: true },
    }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
    proxy,
  },
});
