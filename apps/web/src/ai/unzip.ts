/**
 * Minimal ZIP reader for .docx / .pptx (Office files are ZIP containers).
 * Uses the central directory, which carries reliable sizes even when the
 * local headers were written with data descriptors. Store and deflate only.
 */
export interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const EOCD_SIG = 0x0605_4b50;
const CD_SIG = 0x0201_4b50;
const LOCAL_SIG = 0x0403_4b50;
const MAX_ENTRIES = 10_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export function listZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const length = buffer.byteLength;
  if (length < 22) throw new ZipError('檔案太小，不是有效的 ZIP / Office 檔案');
  const view = new DataView(buffer);

  let eocd = -1;
  const earliest = Math.max(0, length - 22 - 0xffff);
  for (let at = length - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIG) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('找不到 ZIP 目錄結尾');

  const total = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || directoryOffset === 0xffff_ffff || directorySize === 0xffff_ffff) {
    throw new ZipError('暫不支援 ZIP64 格式');
  }
  if (total > MAX_ENTRIES) throw new ZipError('ZIP 檔案項目過多');
  if (directoryOffset + directorySize > length) throw new ZipError('ZIP 目錄超出檔案範圍');

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > length || view.getUint32(cursor, true) !== CD_SIG) {
      throw new ZipError('ZIP 中央目錄損壞');
    }
    const compression = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength > length) throw new ZipError('ZIP 項目名稱超出範圍');

    const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));
    if (!name.endsWith('/')) {
      entries.push({ name, compression, compressedSize, uncompressedSize, localOffset });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('此瀏覽器不支援解壓縮，請改用 .txt 或 .md');
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Response(copy).body;
  if (!stream) throw new ZipError('無法讀取壓縮資料');
  const inflated = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}

export async function readZipEntry(
  buffer: ArrayBuffer,
  entry: ZipEntry,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Uint8Array> {
  if (entry.uncompressedSize > maxBytes) throw new ZipError('壓縮檔內的檔案過大');
  if (entry.compressedSize > maxBytes * 2) throw new ZipError('壓縮檔內的檔案過大');
  const length = buffer.byteLength;
  const at = entry.localOffset;
  if (at + 30 > length) throw new ZipError('ZIP 本機標頭超出範圍');
  const view = new DataView(buffer);
  if (view.getUint32(at, true) !== LOCAL_SIG) throw new ZipError('ZIP 本機標頭損壞');
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const start = at + 30 + nameLength + extraLength;
  if (start + entry.compressedSize > length) throw new ZipError('ZIP 內容超出範圍');

  const data = new Uint8Array(buffer, start, entry.compressedSize);
  if (entry.compression === 0) return data;
  if (entry.compression === 8) return inflateRaw(data);
  throw new ZipError(`不支援的壓縮方式（${entry.compression}）`);
}

export async function readZipText(
  buffer: ArrayBuffer,
  name: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<string | null> {
  const entry = listZipEntries(buffer).find((item) => item.name === name);
  if (!entry) return null;
  const bytes = await readZipEntry(buffer, entry, maxBytes);
  return new TextDecoder().decode(bytes);
}

/** Read every entry matching `pattern`, in archive order. */
export async function readZipTexts(
  buffer: ArrayBuffer,
  pattern: RegExp,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<{ name: string; text: string }[]> {
  const entries = listZipEntries(buffer).filter((entry) => pattern.test(entry.name));
  const decoder = new TextDecoder();
  const output: { name: string; text: string }[] = [];
  let used = 0;
  for (const entry of entries) {
    if (used >= maxBytes) break;
    const bytes = await readZipEntry(buffer, entry, Math.min(DEFAULT_MAX_BYTES, maxBytes - used));
    used += bytes.byteLength;
    output.push({ name: entry.name, text: decoder.decode(bytes) });
  }
  return output;
}
