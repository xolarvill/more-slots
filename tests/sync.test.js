import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../extension/model.js';
import { SyncEngine } from '../extension/sync-engine.js';
import { STATE_KEY, META_KEY, BACKUP_KEY, SITE_PREFIX, SETTINGS_KEY, checkQuota, decodeCloud } from '../extension/sync-model.js';

class Store {
  constructor(data = {}) { this.data = structuredClone(data); this.writes = 0; this.fail = false; }
  async get(keys) {
    if (keys === null) return structuredClone(this.data);
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in this.data).map(key => [key, structuredClone(this.data[key])]));
  }
  async set(values) {
    if (this.fail) throw new Error('Temporary storage failure');
    this.writes++; Object.assign(this.data, structuredClone(values));
  }
}
function custom(id = 'one') {
  const state = initialState(); state.shortcuts = [{ id, name: id, url: `https://${id}.example/` }]; return state;
}
async function device(cloud, state, name, now = 1000) {
  const local = new Store(state ? { [STATE_KEY]: state } : {});
  const engine = new SyncEngine({ local, sync: cloud, uuid: () => name, now: () => now });
  await engine.init(); return engine;
}
async function edit(engine, transform) { const base = structuredClone(engine.state), next = structuredClone(base); transform(next); return engine.save(base, next); }

test('first device retains local config, sync is opt-in and stores no icon/history data', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a');
  assert.equal(cloud.writes, 0); assert.equal(a.meta.enabled, false);
  await a.enable(); assert.equal(a.meta.phase, 'ready'); assert.equal(cloud.writes, 1);
  assert.deepEqual(a.local.data[BACKUP_KEY], custom());
  assert.ok(cloud.data[SITE_PREFIX + 'one']); assert.ok(cloud.data[SETTINGS_KEY]);
  assert.ok(!JSON.stringify(cloud.data).includes('history')); assert.ok(!JSON.stringify(cloud.data).includes('favicon'));
});
test('new device adopts existing cloud list without uploading default shortcuts', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a'); await a.enable();
  const writes = cloud.writes; const b = await device(cloud, null, 'b'); await b.enable();
  assert.deepEqual(b.state, a.state); assert.equal(cloud.writes, writes);
});

test('Chrome object key reordering does not trigger repeated writes', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a'); await a.enable();
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  cloud.data = sorted(cloud.data);
  const writes = cloud.writes;
  await a.flush(); await a.flush();
  assert.equal(a.meta.pending, false); assert.equal(cloud.writes, writes);
  const restarted = await device(cloud, null, 'b'); await restarted.enable(); await restarted.flush();
  assert.equal(cloud.writes, writes);
});
test('existing different data requires a choice; merge deduplicates URLs and keeps backup', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a'); await a.enable();
  const local = custom('two'); local.shortcuts.push({ id: 'duplicate-url', name: 'another name', url: 'https://one.example/' });
  const b = await device(cloud, local, 'b'); const writes = cloud.writes;
  const preview = await b.enable(); assert.equal(preview.needsChoice, true); assert.equal(b.meta.enabled, false); assert.equal(cloud.writes, writes);
  await b.enable('merge'); assert.deepEqual(b.state.shortcuts.map(item => item.id), ['one', 'two']);
  assert.deepEqual(b.local.data[BACKUP_KEY], local);
});
test('explicit cloud/local choice supports replacing and deleting all shortcuts', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a'); await a.enable();
  const b = await device(cloud, custom('two'), 'b'); await b.enable('cloud'); assert.deepEqual(b.state, a.state);
  const c = await device(cloud, { ...custom(), shortcuts: [] }, 'c'); await c.enable('local');
  await a.flush(); await b.flush(); assert.equal(a.state.shortcuts.length, 0); assert.equal(b.state.shortcuts.length, 0);
});
test('concurrent additions converge; stale tabs preserve unrelated remote additions', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a'); await a.enable();
  const b = await device(cloud, null, 'b'); await b.enable();
  const staleBase = structuredClone(a.state);
  await edit(a, next => next.shortcuts.push({ id: 'left', name: 'left', url: 'https://left.example/' }));
  await edit(b, next => next.shortcuts.push({ id: 'right', name: 'right', url: 'https://right.example/' }));
  await a.flush(); await b.flush(); await a.flush();
  assert.deepEqual(a.state, b.state); assert.equal(a.state.shortcuts.length, 3);
  const staleEdit = structuredClone(staleBase); staleEdit.shortcuts[0].name = 'edited in old tab';
  await a.save(staleBase, staleEdit); assert.equal(a.state.shortcuts.length, 3);
});
test('deletion markers prevent old devices and stale sync records from resurrecting sites', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a'); await a.enable();
  const b = await device(cloud, null, 'b'); await b.enable(); const old = structuredClone(cloud.data[SITE_PREFIX + 'one']);
  await edit(a, next => { next.shortcuts = []; }); await a.flush(); await b.flush(); assert.equal(b.state.shortcuts.length, 0);
  cloud.data[SITE_PREFIX + 'one'] = old; await a.flush(); await b.flush();
  assert.equal(cloud.data[SITE_PREFIX + 'one'].deleted, true); assert.equal(b.state.shortcuts.length, 0);
});
test('sort order, settings and disable/re-enable work across devices and restarts', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a'); await a.enable();
  const b = await device(cloud, null, 'b'); await b.enable();
  await edit(a, next => { next.shortcuts.push({ id: 'two', name: 'two', url: 'https://two.example/' }); next.shortcuts.reverse(); next.settings.columns = 10; });
  await a.flush(); await b.flush(); assert.deepEqual(b.state, a.state);
  await b.disable(); const writes = cloud.writes; await edit(b, next => { next.shortcuts[0].name = 'offline edit'; }); await b.flush(); assert.equal(cloud.writes, writes);
  const restarted = new SyncEngine({ local: b.local, sync: cloud, uuid: () => 'unused', now: () => 1000 }); await restarted.init();
  await restarted.enable(); await a.flush(); assert.equal(a.state.shortcuts[0].name, 'offline edit');
});
test('sync failures retain local edits and can retry', async () => {
  const cloud = new Store(); const a = await device(cloud, custom(), 'a'); await a.enable(); cloud.fail = true;
  await edit(a, next => { next.shortcuts[0].name = 'saved locally'; }); await a.flush();
  assert.equal(a.meta.phase, 'error'); assert.equal(a.local.data[STATE_KEY].shortcuts[0].name, 'saved locally');
  cloud.fail = false; await a.flush(); assert.equal(a.meta.phase, 'ready'); assert.equal(cloud.data[SITE_PREFIX + 'one'].name, 'saved locally');
});
test('quota enforcement never partially uploads; reducing never-synced data recovers', async () => {
  const cloud = new Store(); const state = custom(); state.shortcuts = Array.from({ length: 520 }, (_, i) => ({ id: `site-${i}`, name: `${i}`, url: `https://site${i}.example/` }));
  const a = await device(cloud, state, 'a'); await a.enable(); assert.equal(a.meta.phase, 'error'); assert.equal(cloud.writes, 0); assert.equal(a.state.shortcuts.length, 520);
  await edit(a, next => { next.shortcuts = next.shortcuts.slice(0, 5); }); await a.flush();
  assert.equal(a.meta.phase, 'ready'); assert.equal(Object.keys(cloud.data).length, 6);
  assert.throws(() => checkQuota({ huge: 'x'.repeat(8192) }), /8 KB/);
  assert.throws(() => checkQuota(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${i}`, 'x'.repeat(2200)]))), /100 KB/);
});
test('100 entries exceed a single blob but work as separate sync items', async () => {
  const cloud = new Store(); const state = custom(); state.shortcuts = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, name: `Name ${i}`, url: `https://example.com/long-page-${i}` }));
  const a = await device(cloud, state, 'a'); await a.enable(); assert.equal(a.meta.phase, 'ready'); assert.equal(Object.keys(cloud.data).length, 101);
  assert.ok(a.meta.usedBytes < 102400);
});
test('malformed cloud is rejected and corrupt local sync cache disables safely', async () => {
  assert.throws(() => decodeCloud({ [SETTINGS_KEY]: { v: 1, clock: { t: 1, d: 'a' } } }), /设置/);
  const local = new Store({ [STATE_KEY]: custom(), [META_KEY]: { v: 1, device: 'a', tick: 1, enabled: true, records: [{ id: 'bad' }] } });
  const engine = new SyncEngine({ local, sync: new Store() }); await engine.init(); assert.equal(engine.meta.enabled, false); assert.deepEqual(engine.state, custom());
});
