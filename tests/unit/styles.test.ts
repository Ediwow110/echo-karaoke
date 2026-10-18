declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const css = require('node:fs').readFileSync(process.cwd() + '/src/styles.css', 'utf8');

function color(name: string): string {
  const value = css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))?.[1];
  if (!value) throw new Error('Missing --' + name + ' CSS color');
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

describe('landing page CSS', () => {
  it('stacks the hero before tablet columns become too narrow', () => {
    expect(css).toContain('@media (max-width: 790px) { .hero { grid-template-columns: 1fr; } }');
  });

  it('uses accessible muted text for landing-page notes', () => {
    for (const selector of ['.topbar-note', '.quiet-note', '.bottomline p']) {
      const start = css.indexOf(selector + ' {');
      expect(start).toBeGreaterThanOrEqual(0);
      const end = css.indexOf('}', start);
      expect(css.slice(start, end)).toContain('color: var(--muted)');
    }

    const paper = color('paper');
    const muted = color('muted');
    expect(contrast(muted, paper)).toBeGreaterThanOrEqual(4.5);
  });
});
