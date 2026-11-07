/**
 * Material chunking and per-batch selection, server side.
 *
 * A large document holds far more characters than one model call should see.
 * Split on paragraph boundaries, score chunks against the topic, then hand
 * each generation batch a different window so the deck covers the material
 * instead of re-reading the introduction every time.
 */
import type { AiMaterial } from './types';

export const CHUNK_CHARS = 7000;
export const CHUNK_OVERLAP = 350;

export interface TextChunk {
  id: string;
  materialId: string;
  materialName: string;
  index: number;
  text: string;
}

export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const source = text.trim();
  if (!source) return [];
  const chunks: string[] = [];
  let start = 0;

  while (start < source.length) {
    let end = Math.min(source.length, start + size);
    if (end < source.length) {
      // Prefer a paragraph, then a line, then a sentence boundary in the last
      // 40% of the window so chunks stay prose-shaped.
      const windowStart = Math.max(start + Math.floor(size * 0.6), start);
      const tail = source.slice(windowStart, end);
      const paragraph = tail.lastIndexOf('\n\n');
      const line = tail.lastIndexOf('\n');
      const sentence = tail.lastIndexOf('. ');
      const cut = paragraph >= 0 ? paragraph : line >= 0 ? line : sentence >= 0 ? sentence + 1 : -1;
      if (cut > 0) end = windowStart + cut;
    }

    const piece = source.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= source.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

export function buildChunks(materials: readonly AiMaterial[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const material of materials) {
    chunkText(material.text).forEach((text, index) => {
      chunks.push({
        id: `${material.id}#${index}`,
        materialId: material.id,
        materialName: material.name,
        index,
        text,
      });
    });
  }
  return chunks;
}

/** Latin words plus CJK bigrams — enough to rank excerpts for a topic. */
export function queryTerms(topic: string): string[] {
  const lower = topic.toLowerCase();
  const latin = lower.match(/[a-z0-9][a-z0-9+#._-]{1,}/g) ?? [];
  const cjkRuns = topic.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const bigrams: string[] = [];
  for (const run of cjkRuns) {
    for (let index = 0; index < run.length - 1; index += 1) bigrams.push(run.slice(index, index + 2));
  }
  return [...new Set([...latin, ...bigrams])].slice(0, 32);
}

export function scoreChunk(text: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let hits = 0;
    let at = lower.indexOf(term);
    while (at !== -1 && hits < 6) {
      hits += 1;
      at = lower.indexOf(term, at + term.length);
    }
    score += hits;
  }
  return score;
}

export interface ChunkSelectionOptions {
  batchIndex: number;
  batches: number;
  maxChars: number;
  topic: string;
}

export function selectChunksForBatch(
  chunks: readonly TextChunk[],
  options: ChunkSelectionOptions,
): TextChunk[] {
  if (chunks.length === 0) return [];
  const terms = queryTerms(options.topic);
  const ranked = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk.text, terms) }))
    .sort((a, b) => b.score - a.score || a.chunk.materialName.localeCompare(b.chunk.materialName));

  const takeWindow = (start: number): TextChunk[] => {
    const picked: TextChunk[] = [];
    let chars = 0;
    for (let offset = 0; offset < ranked.length; offset += 1) {
      const item = ranked[(start + offset) % ranked.length];
      if (!item) continue;
      const text =
        item.chunk.text.length > options.maxChars
          ? item.chunk.text.slice(0, options.maxChars)
          : item.chunk.text;
      if (chars + text.length > options.maxChars && picked.length > 0) break;
      picked.push(text === item.chunk.text ? item.chunk : { ...item.chunk, text });
      chars += text.length;
      if (chars >= options.maxChars) break;
    }
    return picked;
  };

  if (options.batches <= 1) return takeWindow(0);

  // How many chunks fit in one call; each batch slides by that window.
  let windowSize = 0;
  let chars = 0;
  for (const item of ranked) {
    if (chars + item.chunk.text.length > options.maxChars && windowSize > 0) break;
    chars += item.chunk.text.length;
    windowSize += 1;
    if (chars >= options.maxChars) break;
  }
  const stride = Math.max(1, windowSize);
  return takeWindow((options.batchIndex * stride) % ranked.length);
}
