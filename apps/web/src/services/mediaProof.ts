/**
 * Verification of server-attested images.
 *
 * The API signs the SHA-256 of every photo it generates with an ECDSA P-256
 * key. The public key is published in `/api/ai/config`; the private key stays
 * in the Worker. An image is shown only when its bytes hash to the signed
 * digest and the signature verifies, so replacing the object in Storage (or
 * editing the deck JSON) fails closed.
 *
 * Images generated before attestation existed have no digest and keep working;
 * they simply make no claim of authenticity.
 */
import type { ImageMedia } from '@mengyin/core';
import { base64Bytes, sha256Hex } from '@/lib/hash';

const PAYLOAD_PREFIX = 'mengyin-image:v1:';

let verifyKeyPromise: Promise<string | null> | null = null;
const keyCache = new Map<string, Promise<CryptoKey | null>>();

/** Tests can drop both caches between cases. */
export function resetMediaProofCache(): void {
  verifyKeyPromise = null;
  keyCache.clear();
}

async function importVerifyKey(spki: string): Promise<CryptoKey | null> {
  const cached = keyCache.get(spki);
  if (cached) return cached;
  const promise = (async () => {
    const bytes = base64Bytes(spki);
    if (!bytes) return null;
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    try {
      return await crypto.subtle.importKey('spki', buffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
        'verify',
      ]);
    } catch {
      return null;
    }
  })();
  keyCache.set(spki, promise);
  return promise;
}

/**
 * Fetch the public key from the AI service once per session. A failure is
 * cached as `null` for the rest of the session: retrying on every image would
 * hammer a service that is already down.
 */
export async function loadImageVerifyKey(): Promise<string | null> {
  if (!verifyKeyPromise) {
    verifyKeyPromise = (async () => {
      try {
        // Imported lazily: `@/ai/api` depends on the backend composition root,
        // which imports the storage service that imports this module's caller.
        const { getAiServiceConfig } = await import('@/ai/api');
        const config = await getAiServiceConfig();
        return config.imageVerifyKey ?? null;
      } catch {
        return null;
      }
    })();
  }
  return verifyKeyPromise;
}

/** Verify bytes against a digest and signature with an explicit public key. */
export async function verifyImageBytes(
  bytes: Uint8Array,
  digest: string,
  signature: string,
  verifyKey: string,
): Promise<boolean> {
  if (!digest || !signature) return false;
  const key = await importVerifyKey(verifyKey);
  if (!key) return false;
  const actual = await sha256Hex(bytes);
  if (actual !== digest.trim().toLowerCase()) return false;
  const raw = base64Bytes(signature);
  if (!raw || raw.length !== 64) return false;
  const signatureBytes = new Uint8Array(raw.byteLength);
  signatureBytes.set(raw);
  const payload = new TextEncoder().encode(`${PAYLOAD_PREFIX}${digest.trim().toLowerCase()}`);
  try {
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signatureBytes,
      payload,
    );
  } catch {
    return false;
  }
}

/**
 * Check one stored image. Unsigned (legacy) images pass; a signed image is
 * rejected when the key cannot be fetched, because "cannot verify" must not
 * silently become "trusted".
 */
export async function verifyStoredImage(bytes: Uint8Array, media: ImageMedia): Promise<boolean> {
  if (!media.digest || !media.signature) return true;
  const key = await loadImageVerifyKey();
  if (!key) return false;
  return verifyImageBytes(bytes, media.digest, media.signature, key);
}
