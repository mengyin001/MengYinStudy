import { describe, expect, it } from 'vitest';
import {
  docxXmlToText,
  materialKindOf,
  normalizeMaterialText,
  pptxXmlToText,
} from './extract';
import {
  API_MATERIAL_BUDGET,
  API_MATERIAL_PART_CHARS,
  ingestFiles,
  MAX_MATERIAL_BYTES,
  packMaterialsForApi,
  totalMaterialBytes,
} from './materials';
import type { AiMaterial } from './types';

describe('material types', () => {
  it('maps supported extensions', () => {
    expect(materialKindOf('lecture.pdf')).toBe('pdf');
    expect(materialKindOf('notes.DOCX')).toBe('docx');
    expect(materialKindOf('slides.pptx')).toBe('pptx');
    expect(materialKindOf('notes.md')).toBe('text');
    expect(materialKindOf('data.csv')).toBe('text');
    expect(materialKindOf('photo.png')).toBeNull();
    expect(materialKindOf('noextension')).toBeNull();
  });

  it('normalises whitespace and line endings', () => {
    const text = normalizeMaterialText('  first  \r\n\r\n\r\n\r\n second\t ');
    expect(text).toBe('first\n\n\n second');
  });
});

describe('office XML to text', () => {
  it('keeps paragraphs, tabs and entities from WordprocessingML', () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:tab/><w:r><w:t>&amp; world</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second &#65; line</w:t></w:r></w:p></w:body></w:document>';
    const text = docxXmlToText(xml);
    expect(text).toContain('Hello\t& world');
    expect(text).toContain('Second A line');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(2);
  });

  it('extracts slide text in order', () => {
    expect(pptxXmlToText('<a:t>One</a:t><a:t>Two</a:t>')).toBe('One\nTwo');
  });
});

function existing(size: number): AiMaterial {
  return {
    id: 'existing',
    name: 'existing.pdf',
    size,
    kind: 'pdf',
    chars: 0,
    truncated: false,
    addedAt: 1,
    text: '',
  };
}

describe('material ingestion', () => {
  it('extracts a text file', async () => {
    const file = new File(['# Notes\n\nBinary search halves the search range.'], 'notes.md', {
      type: 'text/markdown',
    });
    const result = await ingestFiles([], [file]);
    expect(result.errors).toEqual([]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.kind).toBe('text');
    expect(result.added[0]?.chars).toBeGreaterThan(10);
    expect(totalMaterialBytes(result.added)).toBe(file.size);
  });

  it('accepts a short topic-only text file', async () => {
    const file = new File(['C++ coding'], '1.txt', { type: 'text/plain' });
    const result = await ingestFiles([], [file]);
    expect(result.errors).toEqual([]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.text).toBe('C++ coding');
  });

  it('skips unsupported files with a message', async () => {
    const result = await ingestFiles([], [new File(['x'], 'diagram.png')]);
    expect(result.added).toHaveLength(0);
    expect(result.errors[0]).toContain('unsupported');
  });

  it('enforces the 1 GB budget before reading', async () => {
    expect(MAX_MATERIAL_BYTES).toBe(1024 ** 3);
    const result = await ingestFiles([existing(MAX_MATERIAL_BYTES)], [
      new File(['small'], 'more.txt'),
    ]);
    expect(result.added).toHaveLength(0);
    expect(result.errors[0]).toContain('1 GB');
  });

  it('rejects an empty file as having no usable text', async () => {
    const result = await ingestFiles([], [new File(['   '], 'empty.txt')]);
    expect(result.added).toHaveLength(0);
    expect(result.errors[0]).toContain('no usable text');
  });
});

function textMaterial(id: string, name: string, text: string): AiMaterial {
  return {
    id,
    name,
    size: text.length,
    kind: 'text',
    chars: text.length,
    truncated: false,
    addedAt: 1,
    text,
  };
}

describe('API material packing', () => {
  it('passes a small set through unchanged', () => {
    const packed = packMaterialsForApi(
      [textMaterial('m1', 'notes.md', 'A stack is LIFO.'), textMaterial('m2', 'empty.md', '   ')],
      'Stacks',
    );
    expect(packed.materials).toEqual([{ name: 'notes.md', text: 'A stack is LIFO.' }]);
    expect(packed.omitted).toBe(0);
  });

  it('keeps at most eight excerpts', () => {
    const materials = Array.from({ length: 9 }, (_, index) =>
      textMaterial(`m${index}`, `${index}.md`, `Material ${index} `.repeat(20)),
    );
    const packed = packMaterialsForApi(materials, 'Material');
    expect(packed.materials.length).toBeLessThanOrEqual(8);
    expect(packed.omitted).toBe(1);
  });

  it('splits and bounds a very large source', () => {
    const text = 'alpha beta gamma '.repeat(40_000);
    const packed = packMaterialsForApi([textMaterial('m1', 'big.pdf', text)], 'alpha');
    const total = packed.materials.reduce((sum, material) => sum + material.text.length, 0);
    expect(packed.materials.length).toBeGreaterThan(0);
    expect(packed.materials.every((material) => material.text.length <= API_MATERIAL_PART_CHARS)).toBe(
      true,
    );
    expect(total).toBeLessThanOrEqual(API_MATERIAL_BUDGET);
    expect(packed.materials[0]?.name).toContain('part 1');
    expect(packed.omitted).toBeGreaterThan(0);
  });
});
