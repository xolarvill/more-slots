import test from 'node:test';
import assert from 'node:assert/strict';
import { iconSources } from '../extension/favicon.js';
import { reorderVisible } from '../extension/reorder.js';

test('icons use exact Chrome cache then origin then website, without brand overrides', () => {
  const runtime = 'chrome-extension://test/_favicon/';
  for (const page of ['https://www.zhihu.com/follow', 'https://www.bilibili.com/video/test', 'https://example.com/a']) {
    const sources = iconSources(page, runtime);
    assert.equal(new URL(sources[0].url).searchParams.get('pageUrl'), page);
    assert.equal(new URL(sources[1].url).searchParams.get('pageUrl'), `${new URL(page).origin}/`);
    assert.equal(sources[2].url, `${new URL(page).origin}/favicon.ico`);
    assert.ok(sources.every(source => !source.url.includes('assets/')));
  }
  assert.equal(iconSources('https://example.com/', runtime).length, 2);
  assert.deepEqual(iconSources('https://example.com/a', null), [{ url: 'https://example.com/favicon.ico', cached: false }]);
  assert.deepEqual(iconSources('javascript:alert(1)', runtime), []);
});
test('visible drag order preserves hidden shortcuts and their contents', () => {
  const items = ['a', 'b', 'c', 'hidden'].map(id => ({ id, name: id, url: `https://${id}.example/` }));
  assert.deepEqual(reorderVisible(items, ['c', 'a', 'b']).map(item => item.id), ['c', 'a', 'b', 'hidden']);
  assert.deepEqual(reorderVisible(items, ['b', 'a']).map(item => item.id), ['b', 'a', 'c', 'hidden']);
  assert.equal(reorderVisible(items, ['c', 'a', 'b'])[0], items[2]);
  assert.deepEqual(items.map(item => item.id), ['a', 'b', 'c', 'hidden']);
  assert.throws(() => reorderVisible(items, ['a', 'a']));
  assert.throws(() => reorderVisible(items, ['unknown']));
});
