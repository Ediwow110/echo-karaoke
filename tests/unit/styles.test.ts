import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const { readFileSync } = require('fs');
const css = readFileSync('src/styles.css', 'utf8');

function colorFromVariable(name: string): string {
  const value = css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))?.[1];
  if (!value) throw new Error('Missing --' + name + ' color token');
  return value;
}

function relativeLuminance(color: string): number {
  const channels = color.match(/[0-9a-fA-F]{2}/g)?.map((channel) => parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error('Invalid color: ' + color);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('landing page CSS', () => {
  it('stacks the hero before tablet columns become too narrow', () => {
    expect(css).toMatch(/\.hero\s*\{[^}]*grid-template-columns:\s*1\.05fr\s+\.95fr/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*790px\)\s*\{[^}]*\.hero\s*\{[^}]*grid-template-columns:\s*1fr/s);
  });

  it('uses one accessible muted color for landing-page notes', () => {
    for (const selector of ['.topbar-note', '.quiet-note', '.bottomline p']) {
      const escaped = selector.replaceAll('.', '\\.');
      expect(css).toMatch(new RegExp(escaped + '\\s*\\{[^}]*color:\\s*var\\(--muted\\)', 's'));
    }

    const paper = colorFromVariable('paper');
    const muted = colorFromVariable('muted');
    const ink = colorFromVariable('ink');
    expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(4.5);
    const bodyText = css.match(/\.hero-description\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/s)?.[1];
    expect(bodyText).toBeDefined();
    expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(bodyText!, paper)).toBeGreaterThanOrEqual(4.5);
  });
});
