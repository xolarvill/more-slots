import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareIdentity, buildFixed, extensionId } from '../scripts/fixed-id.mjs';

test('fixed identity is stable and generated package leaves source unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'more-slots-id-test-'));
  try {
    mkdirSync(join(root, 'extension'));
    const source = JSON.stringify({ manifest_version: 3, name: 'test', version: '1.0.0' });
    writeFileSync(join(root, 'extension', 'manifest.json'), source);
    const identity = prepareIdentity(root);
    assert.match(identity.id, /^[a-p]{32}$/);
    assert.equal(extensionId(identity.publicKey), identity.id);
    assert.deepEqual(prepareIdentity(root), identity);
    const result = buildFixed(root);
    assert.equal(JSON.parse(readFileSync(join(result.output, 'manifest.json'), 'utf8')).key, identity.publicKey);
    assert.equal(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'), source);
    assert.equal(existsSync(join(result.output, 'extension-private.pem')), false);
    assert.equal(existsSync(join(root, '.local', 'extension-private.pem')), true);
    buildFixed(root);
    assert.deepEqual(prepareIdentity(root), identity);
    const damaged = { ...identity, id: 'a'.repeat(32) };
    writeFileSync(join(root, 'config', 'extension-identity.json'), JSON.stringify(damaged));
    assert.throws(() => prepareIdentity(root), /Invalid saved/);
  } finally {
    const actual = realpathSync(root);
    assert.equal(dirname(actual), realpathSync(tmpdir()));
    rmSync(actual, { recursive: true, force: true });
  }
});
