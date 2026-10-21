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

  it('keeps the landing shell edge-to-edge', () => {
    const start = css.indexOf('.home-shell {');
    const end = css.indexOf('}', start);
    expect(css.slice(start, end)).toContain('padding: 0');
  });

  it('defines a premium gold accent color', () => {
    const gold = color('gold');
    expect(gold).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('renders the hero art as a full-bleed panel without a border', () => {
    const start = css.indexOf('.hero-art {');
    const end = css.indexOf('}', start);
    const block = css.slice(start, end);
    expect(block).not.toContain('border:');
    expect(block).not.toContain('border-radius');
  });

  it('styles entry cards with a gold hairline border', () => {
    const start = css.indexOf('.entry-card { position:');
    const end = css.indexOf('}', start);
    expect(css.slice(start, end)).toContain('border: 1px solid');
  });

  it('sets the hero heading to a serif display face', () => {
    const start = css.indexOf('h1 {');
    const end = css.indexOf('}', start);
    expect(css.slice(start, end)).toContain('Playfair Display');
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
    const ink = color('ink');
    const bodyStart = css.indexOf('.hero-description {');
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    const bodyEnd = css.indexOf('}', bodyStart);
    let bodyText = css.slice(bodyStart, bodyEnd).split('color: ')[1]?.split(';')[0];
    if (bodyText?.startsWith('var(--')) {
      bodyText = color(bodyText.match(/--([^)]+)/)![1]);
    }
    expect(bodyText).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(contrast(muted, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(bodyText!, paper)).toBeGreaterThanOrEqual(4.5);
  });
});
