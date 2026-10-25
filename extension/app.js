import { initialState, normalizeUrl, validateState } from './model.js';
import { installSearch } from './search.js';
import { mountFavicon } from './favicon.js';
import { installReordering, reorderVisible } from './reorder.js';
import { installBookmarks } from './bookmarks.js';
import { installSyncUI, syncRequest } from './sync-ui.js';

const $ = id => document.getElementById(id);
const storageKey = 'more-slots-v1';
const extensionMode = Boolean(globalThis.chrome?.storage?.local && globalThis.chrome?.runtime?.id);
let state;
let expanded = false;
let editingId = null;
let menuId = null;
let menuTrigger = null;
let pendingImport = null;
let undoAction = null;
let toastTimer;
let writeQueue = Promise.resolve();
let searchController;
let reorderController;
let bookmarksController;
let syncController;
const colorScheme = matchMedia('(prefers-color-scheme: dark)');

async function read() {
  if (extensionMode) return (await syncRequest('get')).state;
  const value = localStorage.getItem(storageKey);
  return value ? JSON.parse(value) : null;
}
function save(base) {
  const snapshot = structuredClone(state);
  const operation = writeQueue.then(async () => {
    if (extensionMode) state = (await syncRequest('save', { state: snapshot, base: base ?? snapshot })).state;
    else localStorage.setItem(storageKey, JSON.stringify(snapshot));
  });
  writeQueue = operation.catch(() => {});
  return operation;
}
async function commit(next) {
  const previous = state;
  state = next;
  try { await save(previous); render(); return true; }
  catch { state = previous; render(); toast('保存失败，请检查可用存储空间后重试。'); return false; }
}
function toast(message, action) {
  clearTimeout(toastTimer);
  $('toast').querySelector('span').textContent = message;
  $('toast').hidden = false;
  $('undo').hidden = !action;
  undoAction = action;
  toastTimer = setTimeout(() => { $('toast').hidden = true; undoAction = null; }, action ? 10000 : 4500);
}
$('undo').addEventListener('click', async () => {
  const action = undoAction;
  $('toast').hidden = true;
  undoAction = null;
  if (action) await action();
});
function applyTheme() {
  document.documentElement.classList.toggle('theme-dark', state.settings.theme === 'dark' || (state.settings.theme === 'system' && colorScheme.matches));
}
colorScheme.addEventListener('change', () => { if (state) applyTheme(); });
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', name === 'plus' ? 'M12 5v14M5 12h14' : 'M5 12h14');
  svg.append(path);
  return svg;
}
function render() {
  reorderController?.cancel();
  bookmarksController?.refresh();
  applyTheme();
  searchController?.refresh();
  const grid = $('shortcuts');
  grid.style.setProperty('--columns', state.settings.columns);
  grid.replaceChildren();
  const count = state.settings.visibleCount;
  const visible = expanded || count === 0 ? state.shortcuts : state.shortcuts.slice(0, count);
  for (const item of visible) {
    const tile = document.createElement('div');
    tile.className = 'shortcut';
    tile.dataset.id = item.id;
    const link = document.createElement('a');
    link.className = 'shortcut-link';
    link.href = item.url;
    link.title = `${item.name}\n${item.url}`;
    link.draggable = false;
    link.setAttribute('aria-description', '按住并拖动可调整顺序，也可通过菜单移动。');
    if (state.settings.newTab) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    const circle = document.createElement('span');
    circle.className = 'shortcut-icon';
    mountFavicon(circle, item, extensionMode ? chrome.runtime.getURL('/_favicon/') : null);
    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = item.name;
    link.append(circle, label);
    const more = document.createElement('button');
    more.className = 'more';
    more.textContent = '⋮';
    more.setAttribute('aria-label', `编辑 ${item.name}`);
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', event => { event.stopPropagation(); openMenu(item.id, more); });
    tile.addEventListener('contextmenu', event => { event.preventDefault(); openMenu(item.id, more); });
    tile.append(link, more);
    grid.append(tile);
  }
  const add = document.createElement('div');
  add.className = 'shortcut';
  const button = document.createElement('button');
  button.className = 'shortcut-link';
  const circle = document.createElement('span');
  circle.className = 'shortcut-icon';
  circle.append(icon('plus'));
  const label = document.createElement('span');
  label.className = 'shortcut-label';
  label.textContent = '添加快捷方式';
  button.append(circle, label);
  button.addEventListener('click', () => openEditor());
  add.append(button);
  grid.append(add);
  const hiddenCount = state.shortcuts.length - visible.length;
  $('show-more').hidden = count === 0 || state.shortcuts.length <= count;
  $('show-more').textContent = expanded ? '收起快捷方式' : `显示更多（${hiddenCount}）`;
  $('shortcut-count').textContent = `${state.shortcuts.length} 个快捷方式`;
}
function openEditor(item) {
  closeMenu();
  if (!item && state.shortcuts.length >= 1000) return toast('最多支持 1000 个快捷方式');
  editingId = item?.id ?? null;
  $('shortcut-heading').textContent = item ? '编辑快捷方式' : '添加快捷方式';
  $('shortcut-name').value = item?.name ?? '';
  $('shortcut-url').value = item?.url ?? '';
  $('shortcut-error').textContent = '';
  $('shortcut-dialog').showModal();
  $('shortcut-name').focus();
}
$('shortcut-form').addEventListener('submit', async event => {
  event.preventDefault();
  let url;
  try { url = normalizeUrl($('shortcut-url').value); }
  catch { $('shortcut-error').textContent = '请输入有效的网址，例如 https://example.com'; return; }
  const name = $('shortcut-name').value.trim();
  if (!name) { $('shortcut-error').textContent = '请输入名称。'; return; }
  const item = { id: editingId ?? crypto.randomUUID(), name, url };
  const next = structuredClone(state);
  if (editingId) next.shortcuts = next.shortcuts.map(s => s.id === editingId ? item : s);
  else next.shortcuts.push(item);
  if (await commit(next)) {
    if (!editingId) expanded = true;
    render();
    $('shortcut-dialog').close();
    toast(editingId ? '快捷方式已更新' : '快捷方式已添加');
  }
});
function openMenu(id, trigger) {
  menuId = id;
  menuTrigger = trigger;
  const menu = $('shortcut-menu');
  const index = state.shortcuts.findIndex(s => s.id === id);
  menu.querySelector('[data-action=left]').disabled = index === 0;
  menu.querySelector('[data-action=right]').disabled = index === state.shortcuts.length - 1;
  menu.hidden = false;
  const rect = trigger.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector('button').focus();
}
function closeMenu(restore = false) {
  $('shortcut-menu').hidden = true;
  if (restore && menuTrigger?.isConnected) menuTrigger.focus();
  menuId = null;
}
$('shortcut-menu').addEventListener('click', async event => {
  const action = event.target.dataset.action;
  const index = state.shortcuts.findIndex(s => s.id === menuId);
  if (!action || index < 0) return;
  const item = state.shortcuts[index];
  closeMenu();
  if (action === 'edit') return openEditor(item);
  const next = structuredClone(state);
  if (action === 'delete') {
    next.shortcuts.splice(index, 1);
    if (await commit(next)) toast(`已移除 ${item.name}`, async () => {
      const restored = structuredClone(state);
      if (restored.shortcuts.length >= 1000 || restored.shortcuts.some(s => s.id === item.id)) return;
      restored.shortcuts.splice(Math.min(index, restored.shortcuts.length), 0, item);
      if (await commit(restored)) toast('已恢复快捷方式');
    });
  } else {
    const target = index + (action === 'left' ? -1 : 1);
    if (target < 0 || target >= next.shortcuts.length) return;
    [next.shortcuts[index], next.shortcuts[target]] = [next.shortcuts[target], next.shortcuts[index]];
    if (await commit(next)) toast('已更新排序');
  }
});
$('shortcut-menu').addEventListener('keydown', event => {
  const buttons = [...$('shortcut-menu').querySelectorAll('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
  if (event.key === 'Tab') closeMenu();
});
document.addEventListener('click', event => {
  if (!event.target.closest('#shortcut-menu')) closeMenu();
  if (!event.target.closest('.apps-wrap')) toggleApps(false);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeMenu(true); toggleApps(false); } });
window.addEventListener('resize', () => closeMenu());
window.addEventListener('scroll', () => closeMenu(), { passive: true });
function toggleApps(open) { $('apps-panel').hidden = !open; $('apps-toggle').setAttribute('aria-expanded', String(open)); }
$('apps-toggle').addEventListener('click', () => toggleApps($('apps-panel').hidden));
$('show-more').addEventListener('click', () => { expanded = !expanded; render(); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('customize').addEventListener('click', () => {
  const form = $('settings-form');
  for (const [key, value] of Object.entries(state.settings)) {
    const control = form.elements.namedItem(key);
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
  }
  $('settings-error').textContent = '';
  syncController?.refresh();
  $('settings-dialog').showModal();
});
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target.elements;
  const next = structuredClone(state);
  next.settings = { visibleCount: Number(form.visibleCount.value), columns: Number(form.columns.value), newTab: form.newTab.checked, theme: form.theme.value, liveSuggestions: form.liveSuggestions.checked, showBookmarks: form.showBookmarks.checked };
  try { validateState(next); } catch (error) { $('settings-error').textContent = error.message; return; }
  expanded = false;
  if (await commit(next)) { $('settings-dialog').close(); toast('设置已保存'); }
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `more-slots-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('备份已导出');
});
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('备份文件过大，请选择 2 MB 以内的 JSON 文件。');
    pendingImport = validateState(JSON.parse(await file.text()));
    $('import-description').textContent = `此备份包含 ${pendingImport.shortcuts.length} 个快捷方式。`;
    $('import-dialog').showModal();
  } catch (error) { $('settings-error').textContent = error instanceof SyntaxError ? '无法读取 JSON 文件，请选择有效的 More Slots 备份。' : error.message; }
});
$('confirm-import').addEventListener('click', async () => {
  if (!pendingImport) return;
  if (await commit(pendingImport)) {
    pendingImport = null;
    expanded = false;
    render();
    $('import-dialog').close();
    $('settings-dialog').close();
    toast('备份已导入');
  }
});
if (extensionMode) chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[storageKey]?.newValue) {
    try { state = validateState(changes[storageKey].newValue); render(); } catch { toast('其他标签页的数据无效，请检查备份。'); }
  }
});
else window.addEventListener('storage', event => {
  if (event.key === storageKey && event.newValue) { try { state = validateState(JSON.parse(event.newValue)); render(); } catch { /* Preserve the current valid state. */ } }
});
try {
  const stored = await read();
  state = stored ? validateState(stored) : initialState();
  if (!stored) await save();
} catch {
  state = initialState();
  toast('无法读取已保存的数据，已显示默认页面。可尝试导入备份。');
}
render();
searchController = installSearch({ getState: () => state, extensionMode });
bookmarksController = installBookmarks({ getState: () => state, extensionMode });
syncController = installSyncUI({ extensionMode, notify: toast, onResult: result => {
  state = validateState(result.state); render();
  const form = $('settings-form');
  for (const [key, value] of Object.entries(state.settings)) {
    const control = form.elements.namedItem(key);
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
  }
} });
reorderController = installReordering($('shortcuts'), {
  onStart: () => closeMenu(),
  onReorder: async orderedIds => {
    const next = structuredClone(state);
    next.shortcuts = reorderVisible(next.shortcuts, orderedIds);
    if (await commit(next)) toast('已更新排序');
  }
});
