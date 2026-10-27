export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const VALID_CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;
// Accepted symbols that Crockford decoding folds onto a canonical symbol.
const ALIASES: Record<string, string> = {
  I: '1',
  L: '1',
  O: '0',
  U: 'V',
};

export function normalizeRoomCode(value: string): string {
  const stripped = value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .split('')
    .map((symbol) => ALIASES[symbol] ?? symbol)
    .join('');
  return stripped;
}

export function isValidRoomCode(value: string): boolean {
  return VALID_CODE.test(value);
}
