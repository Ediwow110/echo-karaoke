import { describe, expect, it } from 'vitest';
import { roomCodeFromScan } from '../../src/features/scan/roomCodeFromScan';

describe('room code from a scan', () => {
  it('reads the code out of a join link', () => {
    expect(roomCodeFromScan('http://127.0.0.1:5173/join/Z0HHP1YRRQ2QS212')).toBe('Z0HHP1YRRQ2QS212');
  });

  it('reads a code that was scanned on its own', () => {
    expect(roomCodeFromScan('Z0HHP1YRRQ2QS212')).toBe('Z0HHP1YRRQ2QS212');
  });

  it('folds the symbols a camera reads wrong', () => {
    expect(roomCodeFromScan('ZOHHP1YRRQ2QS212')).toBe('Z0HHP1YRRQ2QS212');
  });

  it('ignores a link that does not point at a room', () => {
    expect(roomCodeFromScan('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('ignores text that holds no code', () => {
    expect(roomCodeFromScan('')).toBeNull();
    expect(roomCodeFromScan('not a room at all')).toBeNull();
  });
});
