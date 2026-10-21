export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const CODE_LENGTH = 16;
const VALID_CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;
// Accepted symbols that Crockford decoding folds onto a canonical symbol.
const ALIASES: Record<string, string> = {
  I: '1',
  L: '1',
  O: '0',
  U: 'V',
};

function randomCodeSymbols(count: number): string[] {
  const symbols: string[] = [];
  while (symbols.length < count) {
    const bytes = new Uint8Array(count - symbols.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // Reject values that would bias the modulo, then map into the alphabet.
      if (byte >= 224) continue;
      symbols.push(CROCKFORD_ALPHABET[byte % CROCKFORD_ALPHABET.length]);
      if (symbols.length === count) break;
    }
  }
  return symbols;
}

export function generateRoomCode(): string {
  return randomCodeSymbols(CODE_LENGTH).join('');
}

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
