import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public authentication branding', () => {
  it('uses lowercase kara-echo while retaining the deployed cookie identity', () => {
    const authConfig = readFileSync('server/auth/auth.ts', 'utf8');
    expect(authConfig).toContain("appName: 'kara-echo'");
    expect(authConfig).toContain("cookiePrefix: 'echo'");
  });
});
