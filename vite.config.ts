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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
