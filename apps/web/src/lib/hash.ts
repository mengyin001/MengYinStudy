/**
 * Small hashing helpers shared by storage and image verification.
 *
 * Kept free of imports so `userMedia` can use it without pulling the AI client
 * (and the backend composition root) into a module cycle.
 */

export function bytesToHex(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += bytes[index]!.toString(16).padStart(2, '0');
  return text;
}

export async function sha256Hex(input: Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(digest));
}

/** Decode standard base64 or base64url without depending on `atob` padding rules. */
export function base64Bytes(value: string): Uint8Array | null {
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
