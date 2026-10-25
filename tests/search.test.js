import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDestination, cleanHistory, localSuggestions, mergeSuggestions, canRequestSuggestions } from '../extension/search-model.js';

test('AI Mode opens without a query, regular search stays distinct', () => {
  assert.equal(searchDestination('', true).url, 'https://www.google.com/ai');
  assert.equal(searchDestination(''), null);
  const ordinary = new URL(searchDestination('中文 & test').url);
  assert.equal(ordinary.searchParams.get('q'), '中文 & test');
  assert.equal(ordinary.searchParams.has('udm'), false);
  assert.equal(new URL(searchDestination('中文 & test', true).url).searchParams.get('udm'), '50');
  assert.equal(searchDestination('example.com/path').url, 'https://example.com/path');
  assert.equal(searchDestination('example.com', true).isSearch, true);
});
test('local suggestions match names, URLs and recent searches', () => {
  const shortcuts = [{ name: 'GitHub', url: 'https://github.com/' }, { name: '知乎', url: 'https://zhihu.com/' }];
  const matches = localSuggestions('git', shortcuts, ['git tutorial']);
  assert.ok(matches.some(item => item.type === 'shortcut' && item.value === 'https://github.com/'));
  assert.ok(matches.some(item => item.type === 'history' && item.value === 'git tutorial'));
  assert.equal(localSuggestions('', shortcuts, []).length, 2);
  assert.equal(localSuggestions('https://example.com', shortcuts, [])[0].type, 'url');
});
test('history is bounded, deduplicated, and validated', () => {
  assert.deepEqual(cleanHistory([' hi ', 'HI', {}, '', 'x'.repeat(201), 'hello']), ['hi', 'hello']);
  assert.equal(cleanHistory(Array.from({ length: 80 }, (_, i) => `query ${i}`)).length, 50);
  assert.deepEqual(cleanHistory({}), []);
});
test('remote suggestions reject invalid entries and duplicates', () => {
  const local = localSuggestions('git', [], []);
  const merged = mergeSuggestions(local, ['git', ['git', 'Git', 'git tutorial', {}, null, 'x'.repeat(201)]]);
  assert.deepEqual(merged.map(item => item.label), ['git', 'git tutorial']);
  assert.deepEqual(mergeSuggestions(local, { error: true }), local);
  assert.equal(mergeSuggestions(local, ['git', Array.from({ length: 30 }, (_, i) => `git ${i}`)]).length, 8);
  const site = localSuggestions('git', [{ name: 'GitHub', url: 'https://github.com/' }], []);
  assert.equal(mergeSuggestions(site, ['git', ['https://github.com/']]).length, site.length);
});
test('remote autocomplete skips blank text, long queries and direct URLs', () => {
  for (const input of ['', '  ', 'example.com', 'https://example.com/private?token=test', 'localhost:8080', 'x'.repeat(201)]) assert.equal(canRequestSuggestions(input), false);
  assert.equal(canRequestSuggestions('怎么学习编程'), true);
});
