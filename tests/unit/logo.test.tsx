declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import Logo from '../../src/ui/Logo';
import '@testing-library/jest-dom/vitest';

const read = (path: string) => require('node:fs').readFileSync(process.cwd() + '/' + path, 'utf8');
const logoSource = read('src/ui/Logo.tsx');
const stageSource = read('src/app/HostStagePage.tsx');

function lockup(container: HTMLElement) {
  return container.querySelector('span[aria-label="kara-echo"]') as HTMLElement;
}

function wordmark(container: HTMLElement) {
  return [...lockup(container).children].find((el) => el.textContent === 'kara-echo') as HTMLElement;
}

function bars(container: HTMLElement) {
  return lockup(container).firstElementChild as HTMLElement;
}

afterEach(cleanup);

describe('the brand lockup in a narrow header', () => {
  it('never folds the wordmark onto a second line', () => {
    const { container } = render(<Logo size="md" />);
    expect(wordmark(container)).toHaveClass('whitespace-nowrap');
  });

  it('shrinks every wordmark with the viewport instead of holding one fixed size', () => {
    for (const size of ['sm', 'md'] as const) {
      const { container, unmount } = render(<Logo size={size} />);
      expect(wordmark(container).className).toMatch(/text-\[clamp\(/);
      unmount();
    }
    expect(logoSource.match(/wordmark: 'text-\[clamp\(/g)).toHaveLength(2);
  });

  it('keeps the equalizer bars from being squeezed by the text', () => {
    const { container } = render(<Logo size="md" />);
    expect(bars(container)).toHaveClass('shrink-0');
  });

  it('aims header-specific classes at the wordmark only', () => {
    const { container } = render(<Logo size="md" wordmarkClassName="hidden sm:inline" />);
    expect(wordmark(container)).toHaveClass('hidden', 'sm:inline');
    expect(bars(container)).not.toHaveClass('hidden');
  });

  it('drops the wordmark from the stage header while the back and party actions need the room', () => {
    expect(stageSource).toMatch(/<Logo[^>]*wordmarkClassName="hidden sm:inline"/);
  });
});
