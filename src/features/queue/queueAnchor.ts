export const QUEUE_ELEMENT_ID = 'song-queue';

export function scrollToElement(
  element: Element | null,
  block: ScrollLogicalPosition = 'center',
): void {
  if (element === null || typeof element.scrollIntoView !== 'function') {
    return;
  }
  const reduce = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block });
}

// Brings the shared song queue into view so adding a song lands the singer
// on the queue they just changed.
export function scrollToQueue(): void {
  if (typeof document === 'undefined') {
    return;
  }

  scrollToElement(document.getElementById(QUEUE_ELEMENT_ID), 'start');
}
