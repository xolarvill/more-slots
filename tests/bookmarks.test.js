import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkLabel, bookmarkUrl, bookmarkView } from '../extension/bookmark-model.js';

test('account and local bars use metadata and keep their real order', () => {
  const result = bookmarkView([{ id: 'root', children: [
    { id: 'random-a', title: '书签栏', folderType: 'bookmarks-bar', syncing: true, children: [{ id: 'x', title: '工作' }, { id: 'y', title: '阅读' }] },
    { id: 'random-b', title: '书签栏', folderType: 'bookmarks-bar', syncing: false, children: [{ id: 'z', title: '工作' }] },
    { id: 'random-c', title: '其他书签', folderType: 'other', children: [{ id: 'q', title: '其他' }] }
  ] }]);
  assert.deepEqual(result.barItems.map(item => item.label), ['工作（账号）', '阅读', '工作（本机）']);
  assert.deepEqual(result.barItems.map(item => item.node.id), ['x', 'y', 'z']);
  assert.equal(result.rootTitles.get('random-a'), '书签栏（账号）');
});
test('older browser roots and empty collections are supported', () => {
  const result = bookmarkView([{ children: [{ id: 'a', title: 'Favorites', children: [{ title: 'one' }] }, { id: 'b', title: 'Others' }] }]);
  assert.equal(result.barItems[0].label, 'one');
  assert.deepEqual(bookmarkView([]).barItems, []);
  assert.deepEqual(bookmarkView([{ children: [{ folderType: 'other', children: [{ title: 'not a bar' }] }] }]).barItems, []);
});
test('bookmark titles stay literal; active-content URLs cannot execute', () => {
  assert.equal(bookmarkLabel({ title: '<img onerror=alert(1)>' }), '<img onerror=alert(1)>');
  assert.equal(bookmarkLabel({ title: '', url: 'https://example.com/' }), 'https://example.com/');
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'not a url']) assert.equal(bookmarkUrl(value), null);
  assert.equal(bookmarkUrl('https://example.com'), 'https://example.com/');
  assert.equal(bookmarkUrl('chrome://settings/'), 'chrome://settings/');
  assert.equal(bookmarkUrl('file:///Users/example/file.html'), 'file:///Users/example/file.html');
});
