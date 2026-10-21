import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import PlayerChrome from '../../src/features/playback/PlayerChrome';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('player chrome', () => {
  it('names the song inside the frame', () => {
    render(createElement(PlayerChrome, { playing: false, title: 'Dancing Queen', channel: 'ABBA', children: 'controls' }));
    expect(screen.getByText('Dancing Queen')).toBeInTheDocument();
    expect(screen.getByText('ABBA')).toBeInTheDocument();
    expect(screen.getByText('controls')).toBeInTheDocument();
  });

  it('keeps the controls visible while the room is paused', () => {
    vi.useFakeTimers();
    const { container } = render(createElement(PlayerChrome, { playing: false, title: null, channel: null, children: 'controls' }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector('[data-controls]')?.className).toContain('opacity-100');
  });

  it('hides the controls while a song plays and the host is still', () => {
    vi.useFakeTimers();
    const { container } = render(createElement(PlayerChrome, { playing: true, title: null, channel: null, children: 'controls' }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector('[data-controls]')?.className).toContain('opacity-0');
  });

  it('brings the controls back when the host moves the pointer', () => {
    vi.useFakeTimers();
    const { container } = render(createElement(PlayerChrome, { playing: true, title: null, channel: null, children: 'controls' }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector('[data-controls]')?.className).toContain('opacity-0');

    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    });
    expect(container.querySelector('[data-controls]')?.className).toContain('opacity-100');
  });
});
