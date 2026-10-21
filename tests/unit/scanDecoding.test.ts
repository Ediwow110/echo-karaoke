import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { roomCodeFromScan } from '../../src/features/scan/roomCodeFromScan';

/**
 * Rasterizes a QR code the same way the host screen draws it, so the scanner
 * can be proven against the real code a guest points a phone at.
 */
function rasterize(text: string, margin: number, scale: number): { data: Uint8ClampedArray; width: number; height: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const width = (size + margin * 2) * scale;
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const moduleX = Math.floor(x / scale) - margin;
      const moduleY = Math.floor(y / scale) - margin;
      const inside = moduleX >= 0 && moduleY >= 0 && moduleX < size && moduleY < size;
      const dark = inside && qr.modules.data[moduleY * size + moduleX] === 1;
      const offset = (y * width + x) * 4;
      const value = dark ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  return { data, width, height };
}

describe('scanning the code the host screen shows', () => {
  it('reads the join link out of a scanned code', () => {
    const link = 'http://127.0.0.1:5173/join/Z0HHP1YRRQ2QS212';
    const image = rasterize(link, 4, 4);

    const decoded = jsQR(image.data, image.width, image.height);

    expect(decoded).not.toBeNull();
    expect(decoded?.data).toBe(link);
    expect(roomCodeFromScan(decoded?.data ?? '')).toBe('Z0HHP1YRRQ2QS212');
  });

  it('reads a code that sits inside a tight frame', () => {
    const link = 'http://127.0.0.1:5173/join/Z0HHP1YRRQ2QS212';
    const image = rasterize(link, 1, 4);

    const decoded = jsQR(image.data, image.width, image.height);

    expect(decoded?.data).toBe(link);
    expect(roomCodeFromScan(decoded?.data ?? '')).toBe('Z0HHP1YRRQ2QS212');
  });
});
