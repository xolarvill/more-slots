import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extensionId, verifyIdentity, EXPECTED_ID } from '../scripts/fixed-id.mjs';

test('the directly loadable source manifest preserves the fixed identity', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(extensionId(manifest.key), EXPECTED_ID);
  assert.equal(verifyIdentity(manifest), EXPECTED_ID);
  assert.throws(() => verifyIdentity({}), /fixed public key/);
  assert.throws(() => verifyIdentity({ ...manifest, key: '' }), /fixed public key/);
});
