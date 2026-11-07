/**
 * Image attestation.
 *
 * The browser renders diagrams, and the browser uploads photos to Supabase
 * Storage. A modified client can therefore replace an uploaded bitmap before
 * the row is saved. The API closes that hole by signing the SHA-256 of every
 * photo it generates:
 *
 *   digest    = SHA-256(bytes), lower-case hex
 *   payload   = "mengyin-image:v1:<digest>"
 *   signature = ECDSA P-256 / SHA-256 over payload, base64url
 *
 * The public key is published in `/api/ai/config`; the private key never leaves
 * the Worker. The client verifies the signature before it uploads an image and
 * again before it displays a stored one, so a swapped object is rejected even
 * though the attacker controls the rest of the deck JSON.
 *
 * Diagrams need none of this: they are stored as specs and drawn locally, so
 * there is no uploaded bitmap to tamper with.
 */
import type { Env } from '../env';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;
const PAYLOAD_PREFIX = 'mengyin-image:v1:';

export interface ImageAttestation {
  digest: string;
  signature: string;
}

function base64ToBytes(value: string): Uint8Array | null {
  const cleaned = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!cleaned) return null;
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToHex(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += bytes[index]!.toString(16).padStart(2, '0');
  return text;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(digest));
}

/** Bytes of a base64 data URL, or `null` when it is not one. */
export function dataUrlBytes(value: string): Uint8Array | null {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/is.exec(value.trim());
  if (!match) return null;
  return base64ToBytes(match[1] ?? '');
}

/** The public verification key published in `/config`, if configured. */
export function imageVerifyKey(env: Env): string | null {
  const key = (env.IMAGE_VERIFY_KEY ?? '').trim();
  return key || null;
}

function signingKeyMaterial(env: Env): string | null {
  const key = (env.IMAGE_SIGNING_KEY ?? '').trim();
  return key && imageVerifyKey(env) ? key : null;
}

const keyCache = new Map<string, Promise<CryptoKey | null>>();

function importSigningKey(material: string): Promise<CryptoKey | null> {
  const cached = keyCache.get(material);
  if (cached) return cached;
  const promise = (async () => {
    const bytes = base64ToBytes(material);
    if (!bytes) return null;
    try {
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return await crypto.subtle.importKey('pkcs8', buffer, ALGORITHM, false, ['sign']);
    } catch {
      return null;
    }
  })();
  keyCache.set(material, promise);
  return promise;
}

/**
 * Sign one image's bytes. Returns `null` when signing is not configured, in
 * which case the client stores the image without an attestation (legacy path).
 */
export async function attestImageBytes(env: Env, bytes: Uint8Array): Promise<ImageAttestation | null> {
  const material = signingKeyMaterial(env);
  if (!material) return null;
  const key = await importSigningKey(material);
  if (!key) return null;
  const digest = await sha256Hex(bytes);
  try {
    const signature = await crypto.subtle.sign(
      SIGN_ALGORITHM,
      key,
      new TextEncoder().encode(`${PAYLOAD_PREFIX}${digest}`),
    );
    return { digest, signature: bytesToBase64Url(new Uint8Array(signature)) };
  } catch {
    return null;
  }
}

/** Convenience wrapper for a generated data URL. */
export async function attestImageDataUrl(env: Env, image: string): Promise<ImageAttestation | null> {
  const bytes = dataUrlBytes(image);
  return bytes ? attestImageBytes(env, bytes) : null;
}
