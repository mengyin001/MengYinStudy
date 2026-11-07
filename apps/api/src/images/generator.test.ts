import { describe, expect, it } from 'vitest';
import { createImageGenerator, imageCapability, normalizeImageOutput } from './generator';
import type { Env } from '../env';

// 1×1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0));

describe('image output normalisation', () => {
  it('turns the flux base64 payload into a data URL', async () => {
    const result = await normalizeImageOutput({ image: PNG_BASE64 });
    expect(result).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it('accepts bytes, ArrayBuffers and Response objects', async () => {
    expect(await normalizeImageOutput(PNG_BYTES)).toBe(`data:image/png;base64,${PNG_BASE64}`);
    const buffer = PNG_BYTES.slice().buffer;
    expect(await normalizeImageOutput(buffer)).toBe(`data:image/png;base64,${PNG_BASE64}`);
    const response = new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } });
    expect(await normalizeImageOutput(response)).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it('rejects an empty or unreadable payload', async () => {
    await expect(normalizeImageOutput({})).rejects.toMatchObject({ code: 'image_failed' });
    await expect(normalizeImageOutput(new Uint8Array())).rejects.toMatchObject({ code: 'image_failed' });
  });
});

describe('Cloudflare image generator', () => {
  it('calls the Workers AI binding with the configured model and prompt', async () => {
    const calls: { model: string; input: Record<string, unknown> }[] = [];
    const env: Env = {
      AI: {
        async run(model, input) {
          calls.push({ model, input });
          return { image: PNG_BASE64 };
        },
      },
      IMAGE_STEPS: '4',
    };
    const generator = createImageGenerator(env);
    expect(generator?.model).toBe('@cf/black-forest-labs/flux-1-schnell');
    const result = await generator!.generate('a simple leaf cross-section');
    expect(result.image).toBe(`data:image/png;base64,${PNG_BASE64}`);
    expect(calls[0]?.model).toBe('@cf/black-forest-labs/flux-1-schnell');
    expect(calls[0]?.input.prompt).toContain('a simple leaf cross-section');
    expect(calls[0]?.input.prompt).toContain('no text');
    expect(calls[0]?.input.steps).toBe(4);
  });

  it('falls back to the REST API when an account token is configured', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
    }) as typeof fetch;
    const env: Env = {
      CLOUDFLARE_ACCOUNT_ID: 'account',
      CLOUDFLARE_AI_TOKEN: 'token',
      IMAGE_MODEL: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    };
    const generator = createImageGenerator(env, fetchImpl);
    const result = await generator!.generate('a triangle');
    expect(result.model).toBe('@cf/stabilityai/stable-diffusion-xl-base-1.0');
    expect(result.image).toContain('data:image/png;base64,');
    expect(urls[0]).toContain('/accounts/account/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0');
  });

  it('uses a model requested for this generation', async () => {
    const calls: { model: string; input: Record<string, unknown> }[] = [];
    const env: Env = {
      AI: {
        async run(model, input) {
          calls.push({ model, input });
          return { image: PNG_BASE64 };
        },
      },
      IMAGE_MODELS: '@cf/black-forest-labs/flux-1-schnell,@cf/lykon/dreamshaper-8-lcm',
      IMAGE_STEPS: '4',
    };
    const generator = createImageGenerator(env, fetch, '@cf/lykon/dreamshaper-8-lcm');
    expect(generator?.model).toBe('@cf/lykon/dreamshaper-8-lcm');
    await generator!.generate('a cell');
    expect(calls[0]?.model).toBe('@cf/lykon/dreamshaper-8-lcm');
    // `steps` is a FLUX.1 parameter; SDXL-style models keep their own defaults.
    expect(calls[0]?.input.steps).toBeUndefined();
  });

  it('rejects an image model outside the server allowlist', () => {
    const env: Env = {
      AI: { run: async () => ({}) },
      IMAGE_MODELS: '@cf/black-forest-labs/flux-1-schnell',
    };
    expect(() => createImageGenerator(env, fetch, 'not-a-model')).toThrow(
      /Unknown image model/,
    );
  });

  it('returns a deterministic SVG in demo mode without calling a provider', async () => {
    const generator = createImageGenerator({ AI_MOCK: '1' });
    expect(generator?.demo).toBe(true);
    const first = await generator!.generate('a cell');
    const second = await generator!.generate('a cell');
    expect(first.image).toBe(second.image);
    expect(first.image.startsWith('data:image/svg+xml')).toBe(true);
  });
});

describe('image capability', () => {
  it('reports what the browser may offer', () => {
    expect(imageCapability({})).toMatchObject({ available: false, model: null, models: [] });
    expect(imageCapability({ AI_MOCK: '1' })).toMatchObject({
      available: true,
      model: 'demo-svg',
      models: [{ id: 'demo-svg', label: 'Demo illustration' }],
    });
    const cloudflare = imageCapability({ AI: { run: async () => ({}) } });
    expect(cloudflare).toMatchObject({
      available: true,
      model: '@cf/black-forest-labs/flux-1-schnell',
    });
    expect(cloudflare.models).toEqual([
      { id: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 Schnell' },
    ]);
    expect(imageCapability({ AI_MOCK: '1' }).maxPerRequest).toBe(0);
  });

  it('lists an explicit image-model allowlist with the default first', () => {
    const capability = imageCapability({
      AI: { run: async () => ({}) },
      IMAGE_MODEL: '@cf/lykon/dreamshaper-8-lcm',
      IMAGE_MODELS: '@cf/black-forest-labs/flux-1-schnell,@cf/lykon/dreamshaper-8-lcm',
    });
    expect(capability.model).toBe('@cf/lykon/dreamshaper-8-lcm');
    expect(capability.models.map((model) => model.id)).toEqual([
      '@cf/lykon/dreamshaper-8-lcm',
      '@cf/black-forest-labs/flux-1-schnell',
    ]);
    expect(capability.models[0]?.label).toBe('DreamShaper 8');
  });

  it('returns null when no image provider is configured', () => {
    expect(createImageGenerator({})).toBeNull();
    expect(createImageGenerator({ IMAGE_PROVIDER: 'none' })).toBeNull();
  });
});
