export const QUEUE_ELEMENT_ID = 'song-queue';

// Brings the shared song queue into view so adding a song lands the singer
// on the queue they just changed.
export function scrollToQueue(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const section = document.getElementById(QUEUE_ELEMENT_ID);
  if (section === null || typeof section.scrollIntoView !== 'function') {
    return;
  }

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
