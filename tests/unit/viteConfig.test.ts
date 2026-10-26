declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const source = require('node:fs').readFileSync(process.cwd() + '/vite.config.ts', 'utf8');

describe('the dev server api proxy', () => {
  it('targets the local function runtime, never the port this machine keeps for the POS server', () => {
    // 3001 is a different project's server on this machine: proxying /api there
    // hands the app's room operations to an unrelated service instead of failing.
    expect(source).toContain('VITE_API_DEV_ORIGIN');
    expect(source).toContain('http://127.0.0.1:3002');
    expect(source).not.toContain('127.0.0.1:3001');
  });
});
