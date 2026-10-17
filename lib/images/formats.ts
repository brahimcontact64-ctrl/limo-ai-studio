/**
 * Reads the real format and pixel size from the first bytes of an image file (PNG, JPEG, WebP).
 * Used to verify exports on the server before they are registered, and by tests to decode downloads.
 */
export type ImageFormat = 'png' | 'jpeg' | 'webp';
export interface SniffedImage {
  format: ImageFormat;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  // PNG: signature + IHDR.
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && ascii(bytes, 12, 4) === 'IHDR') {
    return { format: 'png', width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  // JPEG: walk markers to the first start-of-frame.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return null;
      const marker = bytes[o + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        o += 2;
        continue;
      }
      const len = u16be(bytes, o + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { format: 'jpeg', height: u16be(bytes, o + 5), width: u16be(bytes, o + 7) };
      }
      o += 2 + len;
    }
    return null;
  }
  // WebP: RIFF container with VP8 / VP8L / VP8X chunk.
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') return { format: 'webp', width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { format: 'webp', width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const b = bytes;
      return { format: 'webp', width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!), height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)) };
    }
  }
  return null;
}

export const FORMAT_MIME: Record<ImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
export const FORMAT_EXT: Record<ImageFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };
