import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// An operation that is implemented but missing from the allowlist answers
// "That operation is not available", and one that is listed but never dispatched
// answers 501 — both look like a client bug from the outside. This suite once
// shipped a handler that no live entry point reached, so the two lists are now
// checked against each other instead of against memory.
const source = readFileSync('server/operations/index.ts', 'utf8');

const listed = [...source.matchAll(/^  '([a-z-]+)',$/gm)].map((match) => match[1]);
const dispatched = [...source.matchAll(/^      case '([a-z-]+)':$/gm)].map((match) => match[1]);

describe('operation registry', () => {
  it('reads both lists from the source, not from a hand-kept copy', () => {
    // 18 today. The floor exists only so a regex that stops matching cannot turn
    // this gate into a comparison of two empty lists.
    expect(listed.length).toBeGreaterThanOrEqual(15);
    expect(dispatched.length).toBe(listed.length);
  });

  it('dispatches every operation it claims to serve', () => {
    expect(dispatched.filter((name) => !listed.includes(name))).toEqual([]);
    expect(listed.filter((name) => !dispatched.includes(name))).toEqual([]);
  });

  it('serves the host transfer pair', () => {
    expect(listed).toContain('transfer-host');
    expect(listed).toContain('claim-host');
  });
});
