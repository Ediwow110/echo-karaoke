import { describe, expect, it, vi, afterEach } from 'vitest';
import { QUEUE_ELEMENT_ID, scrollToQueue } from '../../src/features/queue/queueAnchor';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('queue anchor', () => {
  it('uses a stable element id', () => {
    expect(QUEUE_ELEMENT_ID).toBe('song-queue');
  });

  it('scrolls the queue into view when it is present', () => {
    const section = document.createElement('section');
    section.id = QUEUE_ELEMENT_ID;
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    document.body.appendChild(section);

    scrollToQueue();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the queue is absent', () => {
    expect(() => scrollToQueue()).not.toThrow();
  });
});
