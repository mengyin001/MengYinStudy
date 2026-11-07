import { beforeAll, describe, expect, it } from 'vitest';
import { attestImageBytes, attestImageDataUrl, imageVerifyKey, sha256Hex } from './attest';
import type { Env } from '../env';

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let signingMaterial: string;
let verifyMaterial: string;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
  signingMaterial = base64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey)));
  verifyMaterial = base64(new Uint8Array(await crypto.subtle.exportKey('spki', publicKey)));
});

function envWithKeys(): Env {
  return { IMAGE_SIGNING_KEY: signingMaterial, IMAGE_VERIFY_KEY: verifyMaterial };
}

describe('image attestation', () => {
  it('publishes the verification key only when configured', () => {
    expect(imageVerifyKey(envWithKeys())).toBe(verifyMaterial);
    expect(imageVerifyKey({})).toBeNull();
  });

  it('signs the SHA-256 of the bytes', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const attestation = await attestImageBytes(envWithKeys(), bytes);
    expect(attestation).not.toBeNull();
    expect(attestation!.digest).toBe(await sha256Hex(bytes));

    const base64Signature = attestation!.signature.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64Signature + '='.repeat((4 - (base64Signature.length % 4)) % 4);
    const signature = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      new TextEncoder().encode(`mengyin-image:v1:${attestation!.digest}`),
    );
    expect(valid).toBe(true);
  });

  it('returns null when signing is not configured', async () => {
    await expect(attestImageBytes({}, Uint8Array.from([1]))).resolves.toBeNull();
    // A signing key without the public half would produce unverifiable images.
    await expect(attestImageBytes({ IMAGE_SIGNING_KEY: signingMaterial }, Uint8Array.from([1]))).resolves.toBeNull();
  });

  it('rejects a malformed key instead of throwing', async () => {
    await expect(
      attestImageBytes({ IMAGE_SIGNING_KEY: 'not base64', IMAGE_VERIFY_KEY: verifyMaterial }, Uint8Array.from([1])),
    ).resolves.toBeNull();
  });

  it('attests a data URL', async () => {
    const attestation = await attestImageDataUrl(envWithKeys(), 'data:image/png;base64,AQID');
    expect(attestation?.digest).toBe(await sha256Hex(Uint8Array.from([1, 2, 3])));
    await expect(attestImageDataUrl(envWithKeys(), 'data:image/svg+xml,<svg/>')).resolves.toBeNull();
  });
});
