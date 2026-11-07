import { describe, expect, it } from 'vitest';
import { createImageSearcher, imageSearchCapability } from './search';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function page(
  options: { license?: string; artist?: string; width?: number; title?: string; description?: string } = {},
): unknown {
  return {
    query: {
      pages: [
        {
          title: `File:${options.title ?? 'Eiffel Tower from the Seine.jpg'}`,
          imageinfo: [
            {
              thumburl: 'https://upload.wikimedia.org/thumb/eiffel.jpg',
              thumbwidth: options.width ?? 1200,
              thumbheight: 800,
              mime: 'image/jpeg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Eiffel_Tower.jpg',
              extmetadata: {
                ...(options.license === undefined
                  ? {}
                  : { LicenseShortName: { value: options.license } }),
                ...(options.artist === undefined ? {} : { Artist: { value: options.artist } }),
                ...(options.description === undefined
                  ? {}
                  : { ImageDescription: { value: options.description } }),
              },
            },
          ],
        },
      ],
    },
  };
}

function mockFetch(payload: unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://commons.wikimedia.org/w/api.php')) {
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
}

describe('image search capability', () => {
  it('defaults to Wikimedia Commons and can be disabled', () => {
    expect(imageSearchCapability({})).toEqual({ available: true, provider: 'wikimedia' });
    expect(imageSearchCapability({ IMAGE_SEARCH: 'off' })).toEqual({
      available: false,
      provider: null,
    });
    expect(imageSearchCapability({ IMAGE_SEARCH: 'unknown' }).available).toBe(false);
  });
});

describe('Wikimedia Commons search', () => {
  it('returns a data URL with the author, licence and file page', async () => {
    const searcher = createImageSearcher(
      { IMAGE_SEARCH: 'wikimedia' },
      mockFetch(page({ license: 'CC BY-SA 4.0', artist: '<a href="#">Jane Doe</a>' })),
    );
    expect(searcher).not.toBeNull();
    const hit = await searcher!.search('Eiffel Tower Paris');
    expect(hit).not.toBeNull();
    expect(hit?.image.startsWith('data:image/png;base64,')).toBe(true);
    expect(hit?.credit).toContain('Jane Doe');
    expect(hit?.credit).toContain('CC BY-SA 4.0');
    expect(hit?.license).toBe('CC BY-SA 4.0');
    expect(hit?.sourceUrl).toBe('https://commons.wikimedia.org/wiki/File:Eiffel_Tower.jpg');
  });

  it('rejects a file without a known licence', async () => {
    const searcher = createImageSearcher({ IMAGE_SEARCH: 'wikimedia' }, mockFetch(page()));
    await expect(searcher!.search('Eiffel Tower')).resolves.toBeNull();
  });

  it('rejects a thumbnail that is too small', async () => {
    const searcher = createImageSearcher(
      { IMAGE_SEARCH: 'wikimedia' },
      mockFetch(page({ license: 'CC0', width: 320 })),
    );
    await expect(searcher!.search('Eiffel Tower')).resolves.toBeNull();
  });

  it('rejects an image whose title and description do not match the query', async () => {
    const searcher = createImageSearcher(
      { IMAGE_SEARCH: 'wikimedia' },
      mockFetch(
        page({
          license: 'CC0',
          title: 'Red apple on a wooden table.jpg',
          description: 'A fruit still life.',
        }),
      ),
    );
    await expect(searcher!.search('Eiffel Tower Paris')).resolves.toBeNull();
  });

  it('returns null rather than throwing when the provider fails', async () => {
    const searcher = createImageSearcher(
      { IMAGE_SEARCH: 'wikimedia' },
      (async () => {
        throw new Error('network down');
      }) as typeof fetch,
    );
    await expect(searcher!.search('Eiffel Tower')).resolves.toBeNull();
  });

  it('sends the query as a bitmap file search', async () => {
    let requested = '';
    const searcher = createImageSearcher(
      { IMAGE_SEARCH: 'wikimedia' },
      (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('commons.wikimedia.org/w/api.php')) {
          requested = url;
          return new Response(JSON.stringify(page({ license: 'CC0' })), {
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      }) as typeof fetch,
    );
    await searcher!.search('Eiffel Tower Paris');
    expect(new URL(requested).searchParams.get('gsrsearch')).toBe(
      'filetype:bitmap Eiffel Tower Paris',
    );
  });
});
