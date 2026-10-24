import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import ErrorBoundary from '../../src/ui/ErrorBoundary';
import '@testing-library/jest-dom/vitest';

function Broken(): never {
  throw new Error('render failed');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('application error boundary', () => {
  it('shows a recovery screen instead of blanking the app', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(createElement(ErrorBoundary, null, createElement(Broken)));
    expect(screen.getByRole('heading', { name: /this screen stopped/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload echo/i })).toBeInTheDocument();
  });
});
