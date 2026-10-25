import { normalizeUrl } from './model.js';

export function searchDestination(value, aiMode = false) {
  const query = String(value).trim();
  if (aiMode && !query) return { url: 'https://www.google.com/ai', isSearch: false };
  if (!query) return null;
  if (!aiMode && (/^https?:\/\//i.test(query) || /^(localhost|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]\S*)?$/i.test(query))) {
    try { return { url: normalizeUrl(query), isSearch: false }; } catch { /* Search malformed addresses as text. */ }
  }
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query);
  if (aiMode) url.searchParams.set('udm', '50');
  return { url: url.href, isSearch: true };
}

export function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(item => {
    if (typeof item !== 'string' || !item.trim() || item.length > 200) return false;
    const key = item.trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => item.trim()).slice(0, 50);
}

export function localSuggestions(query, shortcuts, history) {
  const value = query.trim();
  const key = value.toLocaleLowerCase();
  const results = [];
  if (value) {
    const destination = searchDestination(value);
    results.push({ type: destination.isSearch ? 'search' : 'url', label: value, value, detail: destination.isSearch ? 'Google 搜索' : '直接访问' });
  }
  const recent = cleanHistory(history).filter(text => !key || text.toLocaleLowerCase().includes(key)).slice(0, key ? 2 : 3);
  for (const text of recent) {
    if (text.toLocaleLowerCase() !== key) results.push({ type: 'history', label: text, value: text, detail: '最近搜索' });
  }
  const matches = shortcuts.filter(item => !key || `${item.name} ${item.url}`.toLocaleLowerCase().includes(key)).slice(0, key ? 3 : 5);
  for (const item of matches) results.push({ type: 'shortcut', label: item.name, value: item.url, detail: new URL(item.url).hostname });
  return results.slice(0, 8);
}

export function canRequestSuggestions(value) {
  const query = value.trim();
  return query.length > 0 && query.length <= 200 && searchDestination(query)?.isSearch === true;
}

export function mergeSuggestions(local, payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return local;
  const result = [...local];
  const seen = new Set(local.flatMap(item => [item.label.toLocaleLowerCase(), item.value.toLocaleLowerCase()]));
  for (const text of payload[1]) {
    if (typeof text !== 'string' || !text.trim() || text.length > 200 || seen.has(text.toLocaleLowerCase())) continue;
    seen.add(text.toLocaleLowerCase());
    result.push({ type: 'search', label: text.trim(), value: text.trim(), detail: 'Google 联想' });
    if (result.length >= 8) break;
  }
  return result.slice(0, 8);
}
