import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function extensionId(publicKey) {
  const bytes = Buffer.from(publicKey, 'base64');
  const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'rsa') throw new Error('Expected an RSA public key');
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}

export const EXPECTED_ID = 'fhohijfjoehgofnnnghbgiglmaagemni';

export function verifyIdentity(manifest) {
  if (!manifest.key || extensionId(manifest.key) !== EXPECTED_ID) throw new Error('The extension manifest must preserve its fixed public key');
  return EXPECTED_ID;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const manifest = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));
    console.log(`Fixed extension ID: ${verifyIdentity(manifest)}`);
    console.log('Load the extension/ directory directly. No build is required.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
