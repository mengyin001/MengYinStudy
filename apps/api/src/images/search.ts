/**
 * Web image search for real-world scene questions.
 *
 * A diffusion model is good at "a lantern on a table" and bad at "the Eiffel
 * Tower" or "a cell under a microscope": it invents a plausible-looking subject.
 * For a question whose picture is a real place, object, organism or historical
 * scene, a licensed reference photo is both more accurate and cheaper.
 *
 * Wikimedia Commons is the default provider because it needs no API key, has a
 * public search API, and returns licence and author metadata with every file.
 * Results are downloaded to a data URL, so a saved deck stays self-contained;
 * the attribution is stored with the image and shown in the UI.
 *
 * The search is best-effort. A timeout, an empty result or an unusable licence
 * returns `null`, and the caller falls back to the text-to-image model.
 */
import type { Env } from '../env';
import { normalizeImageOutput } from './generator';

const COMMONS_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'MengYinStudy/0.8 (educational image search; contact: local)';
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;
const MIN_WIDTH = 640;
const MAX_CANDIDATES = 3;
const DEFAULT_TIMEOUT_MS = 12_000;

export interface ImageSearchHit {
  /** Data URL, so the image survives export/import and cloud sync. */
  image: string;
  title: string;
  credit: string;
  sourceUrl: string;
  license: string;
}

export interface ImageSearcher {
  readonly provider: string;
  search(query: string, options?: { signal?: AbortSignal }): Promise<ImageSearchHit | null>;
}

export interface ImageSearchCapability {
  available: boolean;
  provider: string | null;
}

function configuredProvider(env: Env): string {
  const value = (env.IMAGE_SEARCH ?? 'wikimedia').trim().toLowerCase();
  if (!value || value === 'off' || value === 'none' || value === '0' || value === 'false') return '';
  return value;
}

export function imageSearchCapability(env: Env): ImageSearchCapability {
  const provider = configuredProvider(env);
  if (provider !== 'wikimedia') return { available: false, provider: null };
  return { available: true, provider };
}

function limitOf(env: Env): number {
  const value = Number(env.IMAGE_SEARCH_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(value)));
}

function timeoutOf(env: Env): number {
  const value = Number(env.IMAGE_SEARCH_TIMEOUT_MS);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(30_000, Math.max(3_000, Math.round(value)));
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function metaValue(metadata: unknown, key: string): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const entry = (metadata as Record<string, unknown>)[key];
  if (!entry || typeof entry !== 'object') return '';
  const value = (entry as { value?: unknown }).value;
  return typeof value === 'string' ? stripHtml(value).slice(0, 160) : '';
}

interface Candidate {
  url: string;
  /** The original file, tried when the thumbnail host is unavailable. */
  fallbackUrl?: string;
  title: string;
  description: string;
  sourceUrl: string;
  credit: string;
  license: string;
  width: number;
  height: number;
}

const SEARCH_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'along',
  'among',
  'around',
  'because',
  'before',
  'below',
  'between',
  'both',
  'during',
  'each',
  'from',
  'into',
  'near',
  'over',
  'photo',
  'photograph',
  'picture',
  'image',
  'images',
  'landscape',
  'scene',
  'scenes',
  'showing',
  'shown',
  'that',
  'their',
  'there',
  'these',
  'this',
  'through',
  'under',
  'where',
  'which',
  'while',
  'with',
  'within',
]);

/** Distinctive query words, longest first, with generic photo words removed. */
function queryTokens(query: string): string[] {
  const latin = query.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [];
  const cjk = query.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return [
    ...new Set(
      [...latin, ...cjk]
        .filter((token) => !SEARCH_STOP_WORDS.has(token))
        .map((token) => token.replace(/^['-]+|['-]+$/g, '')),
    ),
  ]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function relevanceScore(query: string, candidate: Candidate): number {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;
  const haystack = `${candidate.title} ${candidate.description}`.toLowerCase();
  return tokens.filter((token) => haystack.includes(token)).length;
}

function pageList(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const query = (payload as Record<string, unknown>).query;
  if (!query || typeof query !== 'object') return [];
  const pages = (query as Record<string, unknown>).pages;
  if (Array.isArray(pages)) return pages;
  if (pages && typeof pages === 'object') return Object.values(pages as Record<string, unknown>);
  return [];
}

function candidateOf(page: unknown): Candidate | null {
  if (!page || typeof page !== 'object') return null;
  const item = page as Record<string, unknown>;
  const info = Array.isArray(item.imageinfo) ? item.imageinfo[0] : undefined;
  if (!info || typeof info !== 'object') return null;
  const image = info as Record<string, unknown>;
  const original = typeof image.url === 'string' ? image.url : '';
  const url = typeof image.thumburl === 'string' ? image.thumburl : original;
  if (!/^https:\/\//i.test(url)) return null;
  const mime = typeof image.mime === 'string' ? image.mime : '';
  if (mime && !/^image\/(?:jpeg|png|webp)$/i.test(mime)) return null;
  const width = Number(image.thumbwidth ?? image.width);
  const height = Number(image.thumbheight ?? image.height);
  if (Number.isFinite(width) && width > 0 && width < MIN_WIDTH) return null;
  const metadata = image.extmetadata;
  const license = metaValue(metadata, 'LicenseShortName');
  // A file without a known licence must not be shipped to a learner.
  if (!license) return null;
  const artist = metaValue(metadata, 'Artist');
  const sourceUrl =
    typeof image.descriptionurl === 'string'
      ? image.descriptionurl
      : typeof image.canonicalurl === 'string'
        ? image.canonicalurl
        : url;
  const title = typeof item.title === 'string' ? item.title.replace(/^File:/i, '').slice(0, 160) : 'Wikimedia Commons image';
  const description = metaValue(metadata, 'ImageDescription');
  const parts = [artist, 'Wikimedia Commons', license].filter(Boolean);
  return {
    url,
    ...(original && original !== url ? { fallbackUrl: original } : {}),
    title,
    description,
    sourceUrl,
    credit: [...new Set(parts)].join(' · '),
    license,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

function combineSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  done: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = (): void => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

async function fetchCandidate(
  fetchImpl: typeof fetch,
  candidate: Candidate,
  signal: AbortSignal,
): Promise<ImageSearchHit | null> {
  const urls = [candidate.url, candidate.fallbackUrl].filter(
    (url): url is string => typeof url === 'string' && url.length > 0,
  );
  for (const url of urls) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'image/*', 'User-Agent': USER_AGENT },
        signal,
      });
      if (!response.ok) continue;
      const type = response.headers.get('content-type') ?? '';
      if (type && !type.startsWith('image/')) continue;
      const image = await normalizeImageOutput(response);
      return {
        image,
        title: candidate.title,
        credit: candidate.credit,
        sourceUrl: candidate.sourceUrl,
        license: candidate.license,
      };
    } catch {
      // Try the original file, then the next candidate.
    }
  }
  return null;
}

async function searchCommons(
  env: Env,
  fetchImpl: typeof fetch,
  query: string,
  signal: AbortSignal,
): Promise<ImageSearchHit | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: String(limitOf(env)),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1200',
    origin: '*',
  });
  const response = await fetchImpl(`${COMMONS_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal,
  });
  if (!response.ok) return null;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const ranked = pageList(payload)
    .map(candidateOf)
    .filter((candidate): candidate is Candidate => candidate !== null)
    .map((candidate) => ({ candidate, score: relevanceScore(query, candidate) }));
  // A search with no title/description overlap is not a reference photo for
  // this question. Returning null is better than attaching a random image.
  if (ranked.length === 0 || ranked.every((entry) => entry.score === 0)) return null;
  const candidates = ranked
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const leftLandscape = left.candidate.width >= left.candidate.height ? 1 : 0;
      const rightLandscape = right.candidate.width >= right.candidate.height ? 1 : 0;
      if (leftLandscape !== rightLandscape) return rightLandscape - leftLandscape;
      return right.candidate.width - left.candidate.width;
    })
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.candidate);
  for (const candidate of candidates) {
    const hit = await fetchCandidate(fetchImpl, candidate, signal).catch(() => null);
    if (hit) return hit;
  }
  return null;
}

export function createImageSearcher(env: Env, fetchImpl: typeof fetch = fetch): ImageSearcher | null {
  const capability = imageSearchCapability(env);
  if (!capability.available) return null;
  return {
    provider: 'wikimedia',
    async search(query, options = {}) {
      const clean = query.replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!clean) return null;
      const { signal, done } = combineSignal(options.signal, timeoutOf(env));
      try {
        return await searchCommons(env, fetchImpl, clean, signal);
      } catch {
        // Best-effort: fall back to the image model.
        return null;
      } finally {
        done();
      }
    },
  };
}
