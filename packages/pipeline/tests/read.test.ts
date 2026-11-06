import { describe, expect, it } from 'vitest';
import {
  hasUsableText,
  MIN_USABLE_CHARS,
  meaningfulLength,
  pageNeedsImageRead,
  stripScanFurniture,
} from '../src/read';

const notes =
  'Photosynthesis takes place in the chloroplast. The light reactions occur in ' +
  'the thylakoid membrane and produce ATP and NADPH.';

describe('stripScanFurniture', () => {
  it('removes a CamScanner watermark', () => {
    expect(stripScanFurniture('Scanned by CamScanner')).toBe('');
    expect(stripScanFurniture('Scanned with CamScanner')).toBe('');
    expect(stripScanFurniture('CAMSCANNER')).toBe('');
  });

  it('keeps the notes and drops the stamp on the same line', () => {
    expect(stripScanFurniture('Kinetic energy = ½mv² Scanned by CamScanner')).toBe(
      'Kinetic energy = ½mv²',
    );
  });

  it('removes the stamp repeated down a page', () => {
    const text = `${notes}\nScanned by CamScanner\nScanned by CamScanner\n`;
    expect(stripScanFurniture(text)).toBe(notes);
  });
});

describe('hasUsableText', () => {
  it('rejects null, empty and watermark-only pages', () => {
    expect(hasUsableText(null)).toBe(false);
    expect(hasUsableText('')).toBe(false);
    expect(hasUsableText('Scanned by CamScanner')).toBe(false);
  });

  it('accepts real notes', () => {
    expect(hasUsableText(notes)).toBe(true);
  });

  it('counts Bangla as content', () => {
    const bangla =
      'কোষ বিভাজন দুই প্রকার। মাইটোসিস বিভাজনে ক্রোমোজোমের সংখ্যা অপরিবর্তিত থাকে, ' +
      'কিন্তু মিয়োসিস বিভাজনে ক্রোমোজোমের সংখ্যা অর্ধেক হয়ে যায়।';
    expect(meaningfulLength(bangla)).toBeGreaterThan(MIN_USABLE_CHARS);
    expect(hasUsableText(bangla)).toBe(true);
  });

  it('rejects a page with a watermark plus a couple of stray characters', () => {
    expect(hasUsableText('Scanned by CamScanner\n\n12')).toBe(false);
  });
});

describe('pageNeedsImageRead', () => {
  it('asks for an image read when the text layer holds only a watermark', () => {
    expect(
      pageNeedsImageRead({
        pageNumber: 1,
        text: 'Scanned by CamScanner',
        method: 'text_layer',
        confidence: 1,
      }),
    ).toBe(true);
  });

  it('leaves a printed page with a real text layer alone', () => {
    expect(
      pageNeedsImageRead({
        pageNumber: 1,
        text: notes,
        method: 'text_layer',
        confidence: 1,
      }),
    ).toBe(false);
  });
});
