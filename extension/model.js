export const DEFAULT_SETTINGS = Object.freeze({ visibleCount: 24, columns: 7, newTab: false, theme: 'system', liveSuggestions: true, showBookmarks: true });
export function normalizeUrl(value) {
  let raw = String(value).trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw) || /^[^\s/:?#]+:\d+(?:[/?#]|$)/.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('请输入有效的 http 或 https 网址。');
  return url.href;
}
export function validateState(value) {
  if (!value || !Array.isArray(value.shortcuts) || value.shortcuts.length > 1000) throw new Error('备份格式不正确，最多支持 1000 个快捷方式。');
  const settings = { ...DEFAULT_SETTINGS, ...value.settings };
  if (!Number.isInteger(settings.visibleCount) || settings.visibleCount < 0 || settings.visibleCount > 1000 || !Number.isInteger(settings.columns) || settings.columns < 3 || settings.columns > 12 || !['light', 'dark', 'system'].includes(settings.theme) || typeof settings.newTab !== 'boolean' || typeof settings.liveSuggestions !== 'boolean' || typeof settings.showBookmarks !== 'boolean') throw new Error('备份中的设置无效。');
  const ids = new Set();
  const shortcuts = value.shortcuts.map(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80 || typeof item.url !== 'string' || item.url.length > 2048) throw new Error('备份中的快捷方式无效。');
    let id = typeof item.id === 'string' && item.id.length <= 100 && item.id ? item.id : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    return { id, name: item.name.trim(), url: normalizeUrl(item.url) };
  });
  return { version: 1, settings: { visibleCount: settings.visibleCount, columns: settings.columns, theme: settings.theme, newTab: settings.newTab, liveSuggestions: settings.liveSuggestions, showBookmarks: settings.showBookmarks }, shortcuts };
}
export function initialState() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, shortcuts: [
    ['YouTube', 'https://www.youtube.com/'], ['BMF', 'https://www.bilibili.com/'], ['GitHub', 'https://github.com/'], ['知乎', 'https://www.zhihu.com/'], ['Trading View', 'https://www.tradingview.com/'], ['Schwab', 'https://www.schwab.com/']
  ].map(([name, url]) => ({ id: crypto.randomUUID(), name, url })) };
}
