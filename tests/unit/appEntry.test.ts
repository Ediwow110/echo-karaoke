declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const source = require('node:fs').readFileSync(process.cwd() + '/src/main.tsx', 'utf8');

describe('the app entry', () => {
  it('passes the documented API base URL to the edge client', () => {
    // VITE_API_BASE_URL is documented and deploy-guarded; without this
    // pass-through a deployment configured for a separate API origin silently
    // calls its own /api paths instead.
    expect(source).toContain('baseUrl: import.meta.env.VITE_API_BASE_URL');
  });
});
