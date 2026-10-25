import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
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

  it('plays one short exit before telling the parent to remove it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    const view = render(<Toast message="Saved" tone="success" onDismiss={onDismiss} />);
    fireEvent.click(view.getByRole('button', { name: /dismiss message/i }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(view.container.firstElementChild).toHaveClass('animate-toast-out');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('skips the exit when the user asked for reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as typeof window.matchMedia;

    try {
      const onDismiss = vi.fn();
      const view = render(<Toast message="Saved" onDismiss={onDismiss} />);
      fireEvent.click(view.getByRole('button', { name: /dismiss message/i }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = original;
    }
  });
});
