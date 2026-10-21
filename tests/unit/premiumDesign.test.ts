declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const css = require('node:fs').readFileSync(process.cwd() + '/src/styles.css', 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(selector + ' {');
  if (start < 0) return '';
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

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

describe('premium design system', () => {
  it('self-hosts fonts instead of pulling them from a third-party CDN', () => {
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
    expect(css).toContain('@font-face');
    expect(css).toContain('/fonts/');
  });

  it('never hides text while a font loads', () => {
    const faces = css.split('@font-face').slice(1);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
    }
  });

  it('gives the display face both an upright and an italic cut', () => {
    const faces = css.split('@font-face').slice(1);
    const playfair = faces.filter((face) => face.includes("'Playfair Display'"));
    const upright = playfair.filter((face) => face.includes('font-style: normal'));
    const italic = playfair.filter((face) => face.includes('font-style: italic'));
    expect(upright.length).toBeGreaterThan(0);
    expect(italic.length).toBeGreaterThan(0);
  });

  it('does not let an entrance animation block a hover transform', () => {
    const entrances = [...css.matchAll(/animation:\s*(?:reveal-up|reveal-side|queue-in)[^;]*;/g)].map((entry) => entry[0]);
    expect(entrances.length).toBeGreaterThan(0);
    for (const entrance of entrances) {
      expect(entrance).toContain('backwards');
      expect(entrance).not.toContain('both');
    }
  });

  it('declares motion as tokens instead of scattering durations', () => {
    expect(css).toMatch(/--duration-[a-z-]+:\s*[\d.]+m?s/);
    expect(css).toMatch(/--ease-[a-z-]+:\s*cubic-bezier\(/);
  });

  it('animates only compositor friendly properties', () => {
    const allowed = new Set(['opacity', 'transform']);
    for (const block of keyframeBlocks()) {
      const properties = [...block.matchAll(/([a-z-]+)\s*:/g)].map((entry) => entry[1]);
      for (const property of properties) {
        expect([...allowed]).toContain(property);
      }
    }
  });

  it('reveals the landing page in a staggered sequence', () => {
    expect(css).toContain('@keyframes reveal-up');
    expect(css).toMatch(/animation-delay/);
  });

  it('marks live presence with a slow pulse', () => {
    expect(css).toContain('@keyframes presence-pulse');
    expect(rule('.presence-online')).toContain('presence-pulse');
  });

  it('grows the focus ring instead of snapping it into place', () => {
    const input = rule('.entry-card input');
    expect(input).toContain('transition');
    expect(input).toContain('outline-offset');
  });

  it('halts every animation for visitors who ask for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation-duration: .01ms');
    expect(reduced).toContain('animation-iteration-count: 1');
  });

  it('renders the premium glow without repainting a shadow on every hover', () => {
    const hover = rule('.action-button:hover');
    expect(hover).toContain('scale(1.02)');
    expect(hover).not.toContain('box-shadow');

    const glow = rule('.action-button::after');
    expect(glow).toContain('opacity: 0');
    expect(glow).toContain('box-shadow');

    const lit = rule('.action-button:hover::after');
    expect(lit).toContain('opacity: 1');
  });

  it('presses the primary button into its deeper accent', () => {
    const pressed = rule('.action-primary:active');
    expect(pressed).toContain('scale(.98)');
    expect(pressed).toContain('var(--amber-deep)');
  });

  it('renders native controls in the dark stage palette', () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });
});
