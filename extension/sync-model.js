import { DEFAULT_SETTINGS, initialState, validateState } from './model.js';

export const STATE_KEY = 'more-slots-v1';
export const META_KEY = 'more-slots-sync-v1';
export const BACKUP_KEY = 'more-slots-before-sync-v1';
export const SITE_PREFIX = 'ms-sync.site.';
export const SETTINGS_KEY = 'ms-sync.settings';
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const lexical = (a, b) => a === b ? 0 : a < b ? -1 : 1;

export function compareClock(a, b) {
  return a.t - b.t || lexical(a.d, b.d);
}
export function winner(a, b) {
  if (!a) return b;
  if (!b) return a;
  const comparison = compareClock(a.clock, b.clock);
  return comparison > 0 ? a : comparison < 0 ? b : JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
export function validClock(clock) {
  return clock && Number.isSafeInteger(clock.t) && clock.t >= 0 && typeof clock.d === 'string' && clock.d.length > 0 && clock.d.length <= 100;
}
export function decodeCloud(data) {
  const records = new Map();
  let settings = null;
  for (const [key, record] of Object.entries(data)) {
    if (key !== SETTINGS_KEY && !key.startsWith(SITE_PREFIX)) continue;
    if (!record || record.v !== 1 || !validClock(record.clock)) throw new Error('同步数据格式不受支持，已保留本机配置');
    const clock = { t: record.clock.t, d: record.clock.d };
    if (key === SETTINGS_KEY) {
      if (!record.value || typeof record.value !== 'object' || Array.isArray(record.value)) throw new Error('同步设置记录无效');
      settings = { v: 1, value: validateState({ shortcuts: [], settings: record.value }).settings, clock };
    } else {
      const id = key.slice(SITE_PREFIX.length);
      if (!id || id.length > 100 || id !== record.id || typeof record.deleted !== 'boolean') throw new Error('同步网站记录无效');
      if (record.deleted) records.set(id, { v: 1, id, deleted: true, clock });
      else {
        if (!Number.isSafeInteger(record.rank) || record.rank < 0 || record.rank > 1000000) throw new Error('同步排序记录无效');
        const item = validateState({ shortcuts: [{ id, name: record.name, url: record.url }] }).shortcuts[0];
        records.set(id, { v: 1, ...item, rank: record.rank, deleted: false, clock });
      }
    }
  }
  return { records, settings, exists: records.size > 0 || settings !== null };
}
export function materialize(records, settings) {
  const shortcuts = [...records.values()].filter(record => !record.deleted)
    .sort((a, b) => a.rank - b.rank || compareClock(a.clock, b.clock) || lexical(a.id, b.id))
    .map(({ id, name, url }) => ({ id, name, url }));
  return validateState({ shortcuts, settings: settings?.value ?? DEFAULT_SETTINGS });
}
export function mergeRecords(left, right) {
  const merged = new Map(left);
  for (const [id, record] of right) merged.set(id, winner(merged.get(id), record));
  return merged;
}
export function isStarter(state) {
  const example = initialState();
  return same(state.shortcuts.map(({ name, url }) => ({ name, url })), example.shortcuts.map(({ name, url }) => ({ name, url })));
}
export function mergeFirstJoin(local, cloud) {
  const shortcuts = [...cloud.shortcuts];
  const urls = new Set(shortcuts.map(item => item.url));
  const ids = new Set(shortcuts.map(item => item.id));
  for (const item of local.shortcuts) {
    if (urls.has(item.url) || ids.has(item.id)) continue;
    shortcuts.push(item); urls.add(item.url); ids.add(item.id);
  }
  return validateState({ shortcuts, settings: cloud.settings });
}
export function checkQuota(data) {
  const entries = Object.entries(data);
  if (entries.length > 512) throw new Error('同步记录数量超过 Chrome 限额，本机数据已保存');
  let total = 0;
  for (const [key, value] of entries) {
    const size = bytes(value) + new TextEncoder().encode(key).length;
    if (size > 8192) throw new Error('一条同步记录超过 8 KB，本机数据已保存');
    total += size;
  }
  if (total > 102400) throw new Error('Chrome 同步空间超过 100 KB，本机数据已保存');
  return total;
}
