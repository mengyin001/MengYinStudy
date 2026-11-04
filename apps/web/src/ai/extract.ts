/**
 * Turn an uploaded file into plain text for the question generator.
 *
 * Supported: .pdf (text layer, no OCR), .docx, .pptx, .txt, .md, .csv, .json.
 * Images are ignored — a 1 GB slide deck still contributes only its text.
 */
import type { MaterialKind } from './types';
import { extractPdfText } from './pdf';
import { readZipText, readZipTexts } from './unzip';

export const MAX_MATERIAL_CHARS = 8_000_000;
export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.txt', '.md', '.markdown', '.csv', '.json'] as const;

const EXTENSION_KIND: Record<string, MaterialKind> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.txt': 'text',
  '.md': 'text',
  '.markdown': 'text',
  '.csv': 'text',
  '.json': 'text',
};

export function materialKindOf(fileName: string): MaterialKind | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_KIND[fileName.slice(dot).toLowerCase()] ?? null;
}

export function acceptedFileLabel(): string {
  return ACCEPTED_EXTENSIONS.join(',');
}

export interface ExtractResult {
  text: string;
  kind: MaterialKind;
  truncated: boolean;
}

export interface ExtractOptions {
  maxChars?: number;
  onProgress?: (message: string) => void;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** WordprocessingML → text, keeping paragraph, table and tab structure. */
export function docxXmlToText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<w:cr\b[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n');
  return decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ''));
}

/** DrawingML slides → one text block per slide, in slide order. */
export function pptxXmlToText(xml: string): string {
  const matches = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
  return matches.map((match) => decodeXmlEntities(match[1] ?? '')).join('\n');
}

export function normalizeMaterialText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function slideNumber(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

async function decodeTextFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function extractDocx(file: File, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  const buffer = await file.arrayBuffer();
  const xml = await readZipText(buffer, 'word/document.xml', 48 * 1024 * 1024);
  if (!xml) throw new Error('找不到 word/document.xml，檔案可能不是 .docx');
  const text = docxXmlToText(xml);
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

async function extractPptx(file: File, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  const buffer = await file.arrayBuffer();
  const slides = await readZipTexts(buffer, /^ppt\/slides\/slide\d+\.xml$/, 48 * 1024 * 1024);
  if (slides.length === 0) throw new Error('找不到投影片內容，檔案可能不是 .pptx');
  const ordered = slides.slice().sort((a, b) => slideNumber(a.name) - slideNumber(b.name));
  const text = ordered
    .map((slide, index) => {
      const body = pptxXmlToText(slide.text).trim();
      return body ? `[Slide ${index + 1}]\n${body}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

export async function extractDocument(file: File, options: ExtractOptions = {}): Promise<ExtractResult> {
  const maxChars = options.maxChars ?? MAX_MATERIAL_CHARS;
  const kind = materialKindOf(file.name);
  if (!kind) {
    throw new Error(`不支援的檔案格式：${file.name}。可用：${acceptedFileLabel()}`);
  }

  let text = '';
  let truncated = false;

  if (kind === 'pdf') {
    options.onProgress?.('reading-pdf');
    const result = await extractPdfText(file, {
      maxChars,
      onPage: (page, total) => options.onProgress?.(`pdf:${page}/${total}`),
    });
    text = result.text;
    truncated = result.truncated;
    if (text.trim().length < 20) {
      throw new Error('這個 PDF 沒有可讀的文字層（可能是掃描影像）。請改為上傳文字檔或含文字層的 PDF。');
    }
  } else if (kind === 'docx') {
    const result = await extractDocx(file, maxChars);
    text = result.text;
    truncated = result.truncated;
  } else if (kind === 'pptx') {
    const result = await extractPptx(file, maxChars);
    text = result.text;
    truncated = result.truncated;
  } else {
    const raw = await decodeTextFile(file);
    text = raw.slice(0, maxChars);
    truncated = raw.length > maxChars;
  }

  const normalized = normalizeMaterialText(text).slice(0, maxChars);
  return { text: normalized, kind, truncated };
}
