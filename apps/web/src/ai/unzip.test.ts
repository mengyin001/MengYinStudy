import { describe, expect, it } from 'vitest';
import { listZipEntries, readZipText, readZipTexts } from './unzip';

const LOCAL = 0x0403_4b50;
const CENTRAL = 0x0201_4b50;
const EOCD = 0x0605_4b50;

const supportsDeflateRaw = (() => {
  try {
    if (typeof CompressionStream === 'undefined') return false;
    new CompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
})();

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Entry {
  name: string;
  text: string;
  deflate?: boolean;
}

async function makeZip(entries: Entry[]): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const stored = entry.deflate ? await deflate(entry.text) : data;
    const method = entry.deflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length + stored.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, stored.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(stored, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralLength = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralLength, true);
  ev.setUint32(16, offset, true);

  const total =
    locals.reduce((sum, part) => sum + part.length, 0) + centralLength + eocd.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output.buffer;
}

describe('zip reader', () => {
  it('lists files and reads stored entries', async () => {
    const buffer = await makeZip([
      { name: 'word/document.xml', text: '<w:t>Hello</w:t>' },
      { name: 'docProps/core.xml', text: '<title>Test</title>' },
    ]);
    const entries = listZipEntries(buffer);
    expect(entries.map((entry) => entry.name)).toEqual(['word/document.xml', 'docProps/core.xml']);
    expect(await readZipText(buffer, 'word/document.xml')).toBe('<w:t>Hello</w:t>');
    expect(await readZipText(buffer, 'missing.xml')).toBeNull();
  });

  it.skipIf(!supportsDeflateRaw)('reads deflated entries', async () => {
    const text = '<w:p><w:r><w:t>Compressed lecture notes</w:t></w:r></w:p>'.repeat(20);
    const buffer = await makeZip([{ name: 'word/document.xml', text, deflate: true }]);
    const entries = listZipEntries(buffer);
    expect(entries[0]?.compression).toBe(8);
    expect(await readZipText(buffer, 'word/document.xml')).toBe(text);
  });

  it('filters entries by pattern', async () => {
    const buffer = await makeZip([
      { name: 'ppt/slides/slide2.xml', text: '<a:t>Two</a:t>' },
      { name: 'ppt/slides/slide1.xml', text: '<a:t>One</a:t>' },
      { name: 'ppt/notesSlides/notesSlide1.xml', text: '<a:t>Note</a:t>' },
    ]);
    const slides = await readZipTexts(buffer, /^ppt\/slides\/slide\d+\.xml$/);
    expect(slides.map((slide) => slide.name)).toEqual([
      'ppt/slides/slide2.xml',
      'ppt/slides/slide1.xml',
    ]);
  });

  it('rejects data that is not a zip', () => {
    expect(() => listZipEntries(new ArrayBuffer(8))).toThrow();
  });
});
