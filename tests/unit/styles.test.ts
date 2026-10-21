declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const css = require('node:fs').readFileSync(process.cwd() + '/src/styles.css', 'utf8');

function color(name: string): string {
  const value = css.match(new RegExp('--color-' + name + ':\\s*(#[0-9a-fA-F]{6})'))?.[1];
  if (!value) throw new Error('Missing --color-' + name + ' token');
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('console design tokens', () => {
  it('defines the graphite palette', () => {
    for (const name of ['graphite', 'surface', 'surface-2', 'ink', 'ink-2', 'signal', 'signal-fill', 'live', 'danger']) {
      expect(color(name)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('keeps body text above the AA threshold', () => {
    expect(contrast(color('ink'), color('graphite'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color('ink-2'), color('surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color('ink-3'), color('surface'))).toBeGreaterThanOrEqual(3);
  });

  it('keeps the primary button label readable', () => {
    expect(contrast('#ffffff', color('signal-fill'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the accent readable on graphite', () => {
    expect(contrast(color('signal'), color('graphite'))).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the Space Grotesk display face and drops the serif', () => {
    expect(css).toContain('Space Grotesk');
    expect(css).not.toContain('Playfair');
  });

  it('self-hosts every font', () => {
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
    expect(css).toContain('/fonts/');
  });

  it('never hides text while a font loads', () => {
    const faces = css.split('@font-face').slice(1);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
    }
  });

  it('defines one radius scale', () => {
    expect(css).toMatch(/--radius-panel:\s*14px/);
    expect(css).toMatch(/--radius-badge:\s*8px/);
    expect(css).toMatch(/--radius-media:\s*10px/);
  });

  it('declares motion as tokens', () => {
    expect(css).toMatch(/--duration-fast:\s*140ms/);
    expect(css).toMatch(/--duration-base:\s*200ms/);
    expect(css).toMatch(/--duration-slow:\s*320ms/);
    expect(css).toMatch(/--ease-console:\s*cubic-bezier\(/);
  });

  it('halts every animation for visitors who ask for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation-duration: .01ms');
    expect(reduced).toContain('animation-iteration-count: 1');
  });

  it('renders native controls in the dark palette', () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });
});
