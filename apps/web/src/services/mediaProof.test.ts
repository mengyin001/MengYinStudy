import { beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '@/lib/hash';
import { resetMediaProofCache, verifyImageBytes, verifyStoredImage } from './mediaProof';

let privateKey: CryptoKey;
let spki: string;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  privateKey = pair.privateKey;
  spki = Buffer.from(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))).toString('base64');
});

async function sign(digest: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(`mengyin-image:v1:${digest}`),
  );
  return Buffer.from(new Uint8Array(signature)).toString('base64url');
}

describe('image proof', () => {
  it('accepts bytes that match the signed digest', async () => {
    resetMediaProofCache();
    const bytes = Uint8Array.from([9, 8, 7]);
    const digest = await sha256Hex(bytes);
    const signature = await sign(digest);
    await expect(verifyImageBytes(bytes, digest, signature, spki)).resolves.toBe(true);
  });

  it('rejects swapped bytes', async () => {
    resetMediaProofCache();
    const digest = await sha256Hex(Uint8Array.from([9, 8, 7]));
    const signature = await sign(digest);
    await expect(verifyImageBytes(Uint8Array.from([0, 0, 0]), digest, signature, spki)).resolves.toBe(false);
  });

  it('rejects a signature made for another digest', async () => {
    resetMediaProofCache();
    const bytes = Uint8Array.from([9, 8, 7]);
    const digest = await sha256Hex(bytes);
    const signature = await sign('0'.repeat(64));
    await expect(verifyImageBytes(bytes, digest, signature, spki)).resolves.toBe(false);
  });

  it('rejects a malformed signature or key', async () => {
    resetMediaProofCache();
    const digest = await sha256Hex(Uint8Array.from([1]));
    await expect(verifyImageBytes(Uint8Array.from([1]), digest, 'not-a-signature', spki)).resolves.toBe(false);
    await expect(verifyImageBytes(Uint8Array.from([1]), digest, 'A'.repeat(86), 'not a key')).resolves.toBe(false);
  });

  it('lets legacy images without an attestation through', async () => {
    await expect(
      verifyStoredImage(Uint8Array.from([1]), { type: 'image', src: 'storage:x.png' }),
    ).resolves.toBe(true);
  });
});
