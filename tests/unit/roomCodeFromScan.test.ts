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
    expect(roomCodeFromScan('https://example.com/watch/Z0HHP1YRRQ2QS212')).toBeNull();
    expect(roomCodeFromScan('https://example.com/rooms/Z0HHP1YRRQ2QS212')).toBeNull();
    expect(roomCodeFromScan('https://example.com/join/Z0HHP1YRRQ2QS212/other')).toBeNull();
    expect(roomCodeFromScan('ftp://example.com/join/Z0HHP1YRRQ2QS212')).toBeNull();
    expect(roomCodeFromScan('javascript:/join/Z0HHP1YRRQ2QS212')).toBeNull();
  });

  it('allows a real join link with query/fragment and a trailing slash', () => {
    expect(roomCodeFromScan('https://kara-echo.example/join/Z0HHP1YRRQ2QS212/?utm=qr#join'))
      .toBe('Z0HHP1YRRQ2QS212');
    expect(roomCodeFromScan('/join/Z0HHP1YRRQ2QS212')).toBe('Z0HHP1YRRQ2QS212');
    expect(roomCodeFromScan('https://kara-echo.example/join/zohhp1yrrq2qs212'))
      .toBe('Z0HHP1YRRQ2QS212');
  });

  it('rejects malformed encoded room links without throwing', () => {
    expect(() => roomCodeFromScan('https://kara-echo.example/join/%E0%A4%A'))
      .not.toThrow();
    expect(roomCodeFromScan('https://kara-echo.example/join/%E0%A4%A')).toBeNull();
    expect(roomCodeFromScan('https://kara-echo.example/join/Z0HHP1YRRQ2QS212%2Fextra')).toBeNull();
  });

  it('ignores text that holds no code', () => {
    expect(roomCodeFromScan('')).toBeNull();
    expect(roomCodeFromScan('not a room at all')).toBeNull();
  });
});
