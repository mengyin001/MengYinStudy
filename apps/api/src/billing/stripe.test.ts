import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { cancelSubscriptionAtPeriodEnd, createCheckoutSession, verifyWebhook } from './stripe';

const SECRET = 'whsec_test_secret';

async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

const env: Env = { STRIPE_WEBHOOK_SECRET: SECRET };
const NOW = 1_800_000_000_000;
const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });

describe('verifyWebhook', () => {
  it('accepts a current, correctly signed event', async () => {
    const header = await sign(SECRET, Math.floor(NOW / 1000), body);
    await expect(verifyWebhook(env, body, header, NOW)).resolves.toMatchObject({ id: 'evt_1' });
  });

  it('rejects a body that changed after signing', async () => {
    const header = await sign(SECRET, Math.floor(NOW / 1000), body);
    await expect(
      verifyWebhook(env, `${body} `, header, NOW),
    ).rejects.toThrow(/signature/i);
  });

  it('rejects a signature from another secret', async () => {
    const header = await sign('whsec_other', Math.floor(NOW / 1000), body);
    await expect(verifyWebhook(env, body, header, NOW)).rejects.toThrow(/signature/i);
  });

  it('rejects an old timestamp to block a replay', async () => {
    const header = await sign(SECRET, Math.floor(NOW / 1000) - 3_600, body);
    await expect(verifyWebhook(env, body, header, NOW)).rejects.toThrow(/expired/i);
  });

  it('rejects a malformed header', async () => {
    await expect(verifyWebhook(env, body, 'nonsense', NOW)).rejects.toThrow(/Stripe-Signature/i);
  });

  it('requires the endpoint secret', async () => {
    const header = await sign(SECRET, Math.floor(NOW / 1000), body);
    await expect(verifyWebhook({}, body, header, NOW)).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});

describe('createCheckoutSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enables Adaptive Pricing so Checkout can localise a USD price', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ url: 'https://checkout.stripe.com/test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = await createCheckoutSession(
      {
        STRIPE_SECRET_KEY: 'sk_test_checkout',
        STRIPE_PRICE_LIGHT_MONTH: 'price_light_month',
      } as Env,
      {
        userId: 'user_1',
        plan: 'light',
        interval: 'month',
        customerId: null,
        requestOrigin: 'https://example.test',
      },
    );

    expect(url).toBe('https://checkout.stripe.com/test');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = new URLSearchParams(String(init?.body ?? ''));
    expect(body.get('adaptive_pricing[enabled]')).toBe('true');
    expect(body.get('mode')).toBe('subscription');
    expect(body.get('line_items[0][price]')).toBe('price_light_month');
    expect(body.get('custom_text[submit][message]')).toContain('mengyinqwq@gmail.com');
    expect(body.get('currency')).toBeNull();
  });

  it('stops renewal at the end of the paid period when an account is deleted', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'sub_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await cancelSubscriptionAtPeriodEnd(
      { STRIPE_SECRET_KEY: 'sk_test_cancel' } as Env,
      'sub_1',
    );

    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toContain('/v1/subscriptions/sub_1');
    const init = call?.[1] as RequestInit | undefined;
    const body = new URLSearchParams(String(init?.body ?? ''));
    expect(body.get('cancel_at_period_end')).toBe('true');
  });
});
