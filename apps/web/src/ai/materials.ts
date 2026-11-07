import type { AiMaterialInput } from '@mengyin/ai-contract';
import { appStore, STORAGE_KEYS } from '@/lib/storage';
import { formatBytes } from '@/lib/format';
import { chunkText, queryTerms, scoreChunk } from './chunks';
import { extractDocument, MAX_MATERIAL_CHARS, materialKindOf } from './extract';
import type { AiMaterial } from './types';

/** Hard budget for the material set the learner supplies. */
export const MAX_MATERIAL_BYTES = 1024 * 1024 * 1024;
/** Text kept in IndexedDB across all materials; PDFs are mostly images. */
export const MAX_STORED_CHARS = 32_000_000;
/** The server accepts 400k characters; leave room for the description. */
export const API_MATERIAL_BUDGET = 300_000;
export const API_MATERIAL_MAX = 8;
export const API_MATERIAL_PART_CHARS = 180_000;
// A one-line brief such as "C++ coding" is a valid topic, especially when the
// learner adds a description in the Generate form. Only whitespace is useless.
const MIN_USEFUL_CHARS = 1;

export function materialBudgetLabel(): string {
  return formatBytes(MAX_MATERIAL_BYTES);
}

export function totalMaterialBytes(materials: readonly AiMaterial[]): number {
  return materials.reduce((sum, material) => sum + material.size, 0);
}

export function totalMaterialChars(materials: readonly AiMaterial[]): number {
  return materials.reduce((sum, material) => sum + material.chars, 0);
}

export function createMaterialId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `mat_${crypto.randomUUID()}`;
  }
  return `mat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface IngestProgress {
  fileName: string;
  index: number;
  total: number;
  message: string;
}

export interface IngestResult {
  added: AiMaterial[];
  /** Human-readable reasons some files were skipped. */
  errors: string[];
}

/**
 * Extract files into materials, enforcing both budgets:
 * - the uploaded bytes (1 GB by default), and
 * - the text kept for generation (32 M characters).
 * A file that does not fit is skipped with a message rather than failing the batch.
 */
export async function ingestFiles(
  existing: readonly AiMaterial[],
  files: readonly File[],
  options: { onProgress?: (progress: IngestProgress) => void } = {},
): Promise<IngestResult> {
  const added: AiMaterial[] = [];
  const errors: string[] = [];
  let usedBytes = totalMaterialBytes(existing);
  let usedChars = totalMaterialChars(existing);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;
    const name = file.name || 'material';
    const report = (message: string) =>
      options.onProgress?.({ fileName: name, index: index + 1, total: files.length, message });

    if (!materialKindOf(name)) {
      errors.push(`${name}: unsupported file type`);
      continue;
    }
    if (file.size > MAX_MATERIAL_BYTES) {
      errors.push(`${name}: larger than ${materialBudgetLabel()}`);
      continue;
    }
    if (usedBytes + file.size > MAX_MATERIAL_BYTES) {
      errors.push(`${name}: the ${materialBudgetLabel()} material budget is full — remove a file first`);
      continue;
    }
    if (usedChars >= MAX_STORED_CHARS) {
      errors.push(`${name}: extracted text budget is full — remove a file first`);
      continue;
    }

    try {
      report('extracting');
      const extracted = await extractDocument(file, {
        maxChars: Math.min(MAX_MATERIAL_CHARS, MAX_STORED_CHARS - usedChars),
        onProgress: (message) => report(message),
      });
      if (extracted.text.trim().length < MIN_USEFUL_CHARS) {
        errors.push(`${name}: no usable text found`);
        continue;
      }
      const material: AiMaterial = {
        id: createMaterialId(),
        name,
        size: file.size,
        kind: extracted.kind,
        chars: extracted.text.length,
        truncated: extracted.truncated,
        addedAt: Date.now(),
        text: extracted.text,
      };
      added.push(material);
      usedBytes += file.size;
      usedChars += material.chars;
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { added, errors };
}

function isMaterial(value: unknown): value is AiMaterial {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.id === 'string' &&
    typeof raw.name === 'string' &&
    typeof raw.text === 'string' &&
    typeof raw.size === 'number' &&
    typeof raw.chars === 'number'
  );
}

export async function loadMaterials(): Promise<AiMaterial[]> {
  const stored = await appStore.get<unknown>(STORAGE_KEYS.aiMaterials);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isMaterial).map((material) => ({
    id: material.id,
    name: material.name,
    size: material.size,
    kind: material.kind,
    chars: material.chars,
    truncated: material.truncated === true,
    addedAt: material.addedAt,
    text: material.text,
  }));
}

export async function saveMaterials(materials: readonly AiMaterial[]): Promise<void> {
  await appStore.set(STORAGE_KEYS.aiMaterials, materials);
}

export interface PackedMaterials {
  materials: AiMaterialInput[];
  /** Excerpts dropped to fit the request limit, for a user-facing warning. */
  omitted: number;
}

/**
 * Turn the device's material set into a bounded request body.
 *
 * Up to 300k characters and eight excerpts are sent. Larger sources are split
 * into 180k parts, ranked against the topic, and the best parts are kept. That
 * is several times more text than the generation batches consume, so a 1 GB
 * PDF still contributes its most relevant pages instead of being rejected.
 */
export function packMaterialsForApi(
  materials: readonly AiMaterial[],
  topic: string,
): PackedMaterials {
  const usable = materials
    .filter((material) => material.text.trim().length > 0)
    .map((material) => ({ name: material.name.slice(0, 200), text: material.text }));
  if (usable.length === 0) return { materials: [], omitted: 0 };

  const total = usable.reduce((sum, material) => sum + material.text.length, 0);
  const fits =
    usable.length <= API_MATERIAL_MAX &&
    usable.every((material) => material.text.length <= API_MATERIAL_PART_CHARS) &&
    total <= API_MATERIAL_BUDGET;
  if (fits) return { materials: usable, omitted: 0 };

  const terms = queryTerms(topic);
  const parts: { name: string; text: string; order: number; score: number }[] = [];
  usable.forEach((material, materialIndex) => {
    const pieces =
      material.text.length > API_MATERIAL_PART_CHARS
        ? chunkText(material.text, API_MATERIAL_PART_CHARS, 0)
        : [material.text];
    pieces.forEach((text, partIndex) => {
      parts.push({
        name:
          pieces.length > 1
            ? `${material.name} (part ${partIndex + 1})`.slice(0, 200)
            : material.name,
        text,
        order: materialIndex * 1000 + partIndex,
        score: scoreChunk(text, terms),
      });
    });
  });

  const ranked = [...parts].sort((a, b) => b.score - a.score || a.order - b.order);
  const selected: typeof parts = [];
  let chars = 0;
  for (const part of ranked) {
    if (selected.length >= API_MATERIAL_MAX) break;
    if (chars + part.text.length > API_MATERIAL_BUDGET && selected.length > 0) continue;
    selected.push(part);
    chars += part.text.length;
    if (chars >= API_MATERIAL_BUDGET) break;
  }
  if (selected.length === 0 && ranked[0]) selected.push(ranked[0]);
  selected.sort((a, b) => a.order - b.order);

  return {
    materials: selected.map((part) => ({ name: part.name, text: part.text })),
    omitted: Math.max(0, parts.length - selected.length),
  };
}
