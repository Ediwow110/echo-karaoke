import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Toast from '../../src/ui/Toast';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toast lifetime', () => {
  it('auto-dismisses an ordinary notice', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Saved" onDismiss={onDismiss} />);

    act(() => { vi.advanceTimersByTime(5200); });

    expect(onDismiss).toHaveBeenCalled();
  });

  it('keeps a persistent notice until the host dismisses it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Skipped Afterglow" persistent onDismiss={onDismiss} />);

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByText('Skipped Afterglow')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Dismiss message' }).click();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onDismiss).toHaveBeenCalled();
  });
});
