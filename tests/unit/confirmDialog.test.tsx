import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import ConfirmDialog from '../../src/ui/ConfirmDialog';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('confirm dialog focus', () => {
  it('does not pull focus back to the destructive action on a poll re-render', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();

    const view = render(
      <ConfirmDialog
        open
        title="End the room?"
        description="This cannot be undone."
        confirmLabel="End the room"
        onConfirm={() => undefined}
        onCancel={first}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(30);
    });

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'End the room' });
    expect(document.activeElement).toBe(confirm);

    cancel.focus();
    view.rerender(
      <ConfirmDialog
        open
        title="End the room?"
        description="This cannot be undone."
        confirmLabel="End the room"
        onConfirm={() => undefined}
        onCancel={second}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(30);
    });

    expect(document.activeElement).toBe(cancel);
  });
});
