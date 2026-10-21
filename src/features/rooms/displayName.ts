const MAX_LENGTH = 32;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

function guestName(seed: number | undefined): string {
  const base = seed === undefined ? Math.floor(Math.random() * 100) : seed;
  const normalized = ((base % 100) + 100) % 100;
  return 'Guest ' + String(normalized).padStart(2, '0');
}

export function normalizeDisplayName(value: string, guestNumberSeed?: number): string {
  const cleaned = value.replace(CONTROL_CHARACTERS, '');
  const collapsed = cleaned.replace(/\s+/g, ' ').trim();

  if (collapsed.length === 0) {
    return guestName(guestNumberSeed);
  }

  return Array.from(collapsed).slice(0, MAX_LENGTH).join('').trim();
}
