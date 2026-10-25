import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function extensionId(publicKey) {
  const bytes = Buffer.from(publicKey, 'base64');
  const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'rsa') throw new Error('Expected an RSA public key');
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}

export function prepareIdentity(root) {
  const identityPath = join(root, 'config', 'extension-identity.json');
  if (existsSync(identityPath)) {
    const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
    if (identity.version !== 1 || extensionId(identity.publicKey) !== identity.id) throw new Error('Invalid saved extension identity; do not regenerate it');
    return identity;
  }
  const privatePath = join(root, '.local', 'extension-private.pem');
  if (existsSync(privatePath)) throw new Error('A private key already exists without its identity file. Recover the identity instead of replacing the key.');
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const identity = { version: 1, id: extensionId(publicKey), publicKey };
  mkdirSync(dirname(privatePath), { recursive: true });
  writeFileSync(privatePath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
  mkdirSync(dirname(identityPath), { recursive: true });
  writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, { flag: 'wx' });
  return identity;
}

export function buildFixed(root) {
  root = realpathSync(root);
  const identity = prepareIdentity(root);
  const source = join(root, 'extension');
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
  if (manifest.key && extensionId(manifest.key) !== identity.id) throw new Error('Source manifest has a different fixed ID');
  const dist = join(root, 'dist');
  const output = join(dist, 'extension');
  // Only replace this project's generated directory. Reject redirected folders.
  if (existsSync(dist) && (lstatSync(dist).isSymbolicLink() || realpathSync(dist) !== dist)) throw new Error('dist must be a normal project directory');
  mkdirSync(dist, { recursive: true });
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error('Generated extension directory cannot be a link');
  if (resolve(output) !== join(root, 'dist', 'extension')) throw new Error('Unexpected output path');
  rmSync(output, { recursive: true, force: true });
  cpSync(source, output, { recursive: true });
  manifest.key = identity.publicKey;
  writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { identity, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const command = process.argv[2] ?? 'status';
    if (command === 'prepare') {
      console.log(`Fixed extension ID: ${prepareIdentity(root).id}`);
      console.log('Saved public identity in config/extension-identity.json. Existing extension/manifest.json is unchanged.');
    } else if (command === 'build') {
      const { identity, output } = buildFixed(root);
      console.log(`Fixed extension ID: ${identity.id}\nLoad unpacked directory: ${output}`);
      console.log('Export your old extension data first, then load this directory and import the backup.');
    } else if (command === 'status') {
      const path = join(root, 'config', 'extension-identity.json');
      console.log(existsSync(path) ? `Fixed extension ID: ${prepareIdentity(root).id}` : 'No identity prepared. Run npm run id:prepare.');
    } else throw new Error('Usage: node scripts/fixed-id.mjs [prepare|build|status]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
