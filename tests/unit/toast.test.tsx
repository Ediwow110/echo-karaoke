import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import Toast from '../../src/ui/Toast';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toast lifetime', () => {
  it('still dismisses after a parent poll re-renders with a new callback', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();

    const view = render(<Toast message="Saved" tone="success" onDismiss={first} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    view.rerender(<Toast message="Saved" tone="success" onDismiss={second} />);
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
