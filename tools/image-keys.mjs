#!/usr/bin/env node
/**
 * Generate the ECDSA P-256 keypair used to attest generated photos.
 *
 *   npm run image:keys
 *
 * Paste the two base64 values into `.dev.vars` (local) or
 * `wrangler secret put IMAGE_SIGNING_KEY` / `IMAGE_VERIFY_KEY` (deployed).
 * The signing key is a secret; the verification key is public and is served
 * by `/api/ai/config` so the browser can check stored images.
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  publicKeyEncoding: { type: 'spki', format: 'der' },
});

const encode = (buffer) => Buffer.from(buffer).toString('base64');

console.log('Add these to .dev.vars (or set them as Worker secrets):\n');
console.log(`IMAGE_SIGNING_KEY=${encode(privateKey)}`);
console.log(`IMAGE_VERIFY_KEY=${encode(publicKey)}`);
console.log('\nThe signing key is a secret. The verification key is public.');
