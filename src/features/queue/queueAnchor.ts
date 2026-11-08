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
