import { describe, expect, it, vi, afterEach } from 'vitest';
import { QUEUE_ELEMENT_ID, scrollToElement } from '../../src/features/queue/queueAnchor';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('queue anchor', () => {
  it('uses a stable element id', () => {
    expect(QUEUE_ELEMENT_ID).toBe('song-queue');
  });

  it('scrolls the queue element into view when it is present', () => {
    const section = document.createElement('section');
    section.id = QUEUE_ELEMENT_ID;
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    document.body.appendChild(section);

    scrollToElement(document.getElementById(QUEUE_ELEMENT_ID), 'start');

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
  });

  it('does nothing when the queue is absent', () => {
    expect(() => scrollToElement(null)).not.toThrow();
  });
});
