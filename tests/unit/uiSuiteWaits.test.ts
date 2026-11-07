import { describe, expect, it } from 'vitest';

declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };

const read = (path: string) => require('node:fs').readFileSync(process.cwd() + '/' + path, 'utf8');

// The mocked specs drive screens that poll, so a "wait until the network is
// quiet" navigation is both slow and a race. Measured on the dev server,
// `networkidle` took 720 ms where `load` took 160 ms, and the suite's slowest
// test sat at 22.9 s of its 30 s budget.
//
// But `load` alone is too early: the app lazy-loads every screen, so a goto
// that stops there returns before the screen exists. Measured immediately
// after `load`, a room screen had zero links and buttons. Every test that then
// measured geometry, or asserted a control count of zero, passed without
// having looked at anything. `openScreen` waits for the heading RouteFocus
// stamps once the screen mounts, which is the earliest fact that means it.
const SPECS = ['tests/e2e/ui-mock.spec.ts', 'tests/e2e/ui-mock-moderation.spec.ts'];
const HELPER = 'tests/e2e/screen.ts';

describe('the mocked browser suite waits on content, not on quiet', () => {
  it.each(SPECS)('%s navigates only through the screen helpers', (spec) => {
    const source = read(spec);
    expect(source.match(/\.(goto|reload)\(/g) ?? []).toEqual([]);
    expect(source).toMatch(/from '\.\/screen'/);
  });

  it('waits for the mounted heading, not just for load', () => {
    const helper = read(HELPER);
    expect(helper).toMatch(/waitUntil: 'load'/);
    expect(helper.match(/\[data-route-focus\]/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it.each([...SPECS, HELPER])('%s never waits for the network to go idle', (file) => {
    expect(read(file)).not.toMatch(/waitUntil:\s*['"]networkidle['"]/);
  });
});
