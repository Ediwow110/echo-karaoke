declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const css = require('node:fs').readFileSync(process.cwd() + '/src/styles.css', 'utf8');

function keyframeBlocks(): string[] {
  const blocks: string[] = [];
  const pattern = /@keyframes\s+([\w-]+)\s*\{/g;
  let match = pattern.exec(css);
  while (match !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(match.index + match[0].length, index - 1));
    match = pattern.exec(css);
  }
  return blocks;
}

describe('console design system', () => {
  it('animates only compositor friendly properties', () => {
    const allowed = new Set(['opacity', 'transform']);
    for (const block of keyframeBlocks()) {
      const properties = [...block.matchAll(/([a-z-]+)\s*:/g)].map((entry) => entry[1]);
      for (const property of properties) {
        expect([...allowed]).toContain(property);
      }
    }
  });

  it('reveals a screen in a staggered sequence', () => {
    expect(css).toContain('@keyframes console-in');
    expect(css).toMatch(/--animate-console-in/);
  });

  it('slides a new queue row into place', () => {
    expect(css).toContain('@keyframes queue-in');
  });

  it('marks live presence with a slow pulse', () => {
    expect(css).toContain('@keyframes presence-pulse');
  });

  it('gives the tooltip a hover and a focus state', () => {
    expect(css).toContain('.tooltip:hover::after');
    expect(css).toContain('.tooltip:focus-within::after');
  });

  it('draws a skeleton that matches the panel shape', () => {
    expect(css).toContain('.skeleton');
    expect(css).toContain('@keyframes skeleton-pulse');
  });

  it('keeps a visible focus ring on every control', () => {
    expect(css).toMatch(/focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--color-signal\)/);
  });
});
