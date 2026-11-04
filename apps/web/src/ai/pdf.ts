/**
 * PDF text extraction via pdf.js. Loaded lazily so the 1.2 MB worker only
 * ships when a learner actually adds a PDF. Images are never decoded: only the
 * text layer is read, which is what keeps large picture-heavy PDFs workable.
 */
export interface PdfExtractResult {
  text: string;
  pages: number;
  truncated: boolean;
}

export interface PdfExtractOptions {
  maxChars: number;
  maxPages?: number;
  onPage?: (page: number, total: number) => void;
}

type PdfModule = typeof import('pdfjs-dist');

let pdfjsLoader: Promise<PdfModule> | null = null;

async function loadPdfjs(): Promise<PdfModule> {
  pdfjsLoader ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsLoader;
}

export async function extractPdfText(file: File, options: PdfExtractOptions): Promise<PdfExtractResult> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
  });
  const document = await task.promise;
  const maxPages = Math.min(document.numPages, options.maxPages ?? 600);
  const pages: string[] = [];
  let chars = 0;
  let truncated = document.numPages > maxPages;

  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      options.onPage?.(pageNumber, maxPages);
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let pageText = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          pageText += item.str;
          pageText += item.hasEOL ? '\n' : ' ';
        }
        pages.push(pageText.trim());
        chars += pageText.length;
      } finally {
        page.cleanup();
      }
      if (chars >= options.maxChars) {
        truncated = pageNumber < document.numPages;
        break;
      }
    }
  } finally {
    await document.destroy();
  }

  const joined = pages
    .filter((page) => page.length > 0)
    .join('\n\n');
  const text = joined.slice(0, options.maxChars);
  return { text, pages: maxPages, truncated: truncated || text.length < joined.length };
}
