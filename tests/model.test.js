import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, normalizeUrl, validateState } from '../extension/model.js';

test('URLs gain HTTPS and reject active content and embedded credentials', () => {
  assert.equal(normalizeUrl(' example.com/path?q=x '), 'https://example.com/path?q=x');
  assert.equal(normalizeUrl('http://localhost:8080'), 'http://localhost:8080/');
  assert.equal(normalizeUrl('localhost:8080'), 'https://localhost:8080/');
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///C:/test', 'https://user:pass@example.com', 'https://', 'not a url']) assert.throws(() => normalizeUrl(url));
});
test('backup roundtrip preserves shortcuts and settings', () => {
  const state = initialState();
  state.settings.visibleCount = 0;
  state.settings.columns = 12;
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
});

test('1.0.0 stored settings and backups upgrade without losing shortcuts', () => {
  const state = initialState();
  state.settings.showPromos = true;
  state.settings.visibleCount = 0;
  state.settings.columns = 9;
  delete state.settings.liveSuggestions;
  delete state.settings.showBookmarks;
  const parsed = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(parsed.shortcuts, state.shortcuts);
  assert.equal(parsed.settings.visibleCount, 0);
  assert.equal(parsed.settings.columns, 9);
  assert.equal('showPromos' in parsed.settings, false);
  assert.equal(parsed.settings.liveSuggestions, true);
  assert.equal(parsed.settings.showBookmarks, true);
});
test('unsafe backups and out-of-range settings are rejected', () => {
  for (const patch of [{ visibleCount: -1 }, { visibleCount: 1.5 }, { columns: 13 }, { theme: 'oops' }, { newTab: 'true' }, { liveSuggestions: 'true' }, { showBookmarks: 'true' }]) {
    const state = initialState();
    Object.assign(state.settings, patch);
    assert.throws(() => validateState(state));
  }
  const state = initialState();
  state.shortcuts[0].url = 'javascript:alert(1)';
  assert.throws(() => validateState(state));
  assert.throws(() => validateState({ shortcuts: Array(1001).fill({}) }));
});
test('duplicate IDs are repaired and 1000 shortcuts are supported', () => {
  const state = initialState();
  state.shortcuts = Array.from({ length: 1000 }, (_, i) => ({ id: 'duplicate', name: `Site ${i}`, url: 'https://example.com' }));
  const parsed = validateState(state);
  assert.equal(new Set(parsed.shortcuts.map(s => s.id)).size, 1000);
});
