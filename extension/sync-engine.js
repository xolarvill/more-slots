import { initialState, validateState } from './model.js';
import { BACKUP_KEY, META_KEY, SETTINGS_KEY, SITE_PREFIX, STATE_KEY, checkQuota, decodeCloud, isStarter, materialize, mergeFirstJoin, mergeRecords, same, winner } from './sync-model.js';

export class SyncEngine {
  constructor({ local, sync, now = Date.now, uuid = () => crypto.randomUUID() }) {
    this.local = local; this.sync = sync; this.now = now; this.uuid = uuid;
    this.records = new Map(); this.settings = null; this.loaded = false;
    this.knownRemote = new Set();
  }
  async init() {
    if (this.loaded) return;
    const data = await this.local.get([STATE_KEY, META_KEY, BACKUP_KEY]);
    this.state = data[STATE_KEY] ? validateState(data[STATE_KEY]) : initialState();
    const stored = data[META_KEY];
    this.meta = { v: 1, enabled: false, joined: false, device: this.uuid(), tick: 0, phase: 'off', detail: '未启用同步', usedBytes: 0, pending: false, lastSubmitted: null, lastReceived: null };
    if (stored?.v === 1 && typeof stored.device === 'string' && Number.isSafeInteger(stored.tick)) {
      this.meta = { ...this.meta, ...stored };
      this.knownRemote = new Set(Array.isArray(stored.knownRemote) ? stored.knownRemote.filter(id => typeof id === 'string') : []);
      try {
        const saved = decodeCloud(Object.fromEntries([
          ...(stored.records ?? []).map(record => [SITE_PREFIX + record.id, record]),
          ...(stored.settings ? [[SETTINGS_KEY, stored.settings]] : [])
        ]));
        this.records = saved.records; this.settings = saved.settings;
      } catch {
        this.meta.enabled = false; this.meta.joined = false; this.meta.pending = false;
        this.meta.phase = 'error'; this.meta.detail = '同步缓存无效，已保留本机配置，请重新启用同步';
      }
    }
    this.hasBackup = Boolean(data[BACKUP_KEY]);
    this.loaded = true;
    await this.persist();
  }
  stamp() { this.meta.tick = Math.max(this.now(), this.meta.tick + 1); return { t: this.meta.tick, d: this.meta.device }; }
  observe(cloud) {
    for (const record of [...cloud.records.values(), ...(cloud.settings ? [cloud.settings] : [])]) this.meta.tick = Math.max(this.meta.tick, record.clock.t);
  }
  status() {
    return { enabled: this.meta.enabled, phase: this.meta.phase, detail: this.meta.detail, usedBytes: this.meta.usedBytes, pending: this.meta.pending, lastSubmitted: this.meta.lastSubmitted, lastReceived: this.meta.lastReceived, hasBackup: this.hasBackup, count: this.state.shortcuts.length };
  }
  result(extra = {}) { return { state: this.state, status: this.status(), ...extra }; }
  async persist(extra = {}) {
    await this.local.set({ [STATE_KEY]: this.state, [META_KEY]: { ...this.meta, records: [...this.records.values()], settings: this.settings, knownRemote: [...this.knownRemote] }, ...extra });
  }
  capture(base, next) {
    const old = new Map(base.shortcuts.map((item, rank) => [item.id, { ...item, rank }]));
    const incoming = new Set(next.shortcuts.map(item => item.id));
    next.shortcuts.forEach((item, rank) => {
      const previous = old.get(item.id);
      if (!previous || previous.name !== item.name || previous.url !== item.url || previous.rank !== rank) this.records.set(item.id, { v: 1, ...item, rank, deleted: false, clock: this.stamp() });
    });
    for (const item of base.shortcuts) if (!incoming.has(item.id)) this.records.set(item.id, { v: 1, id: item.id, deleted: true, clock: this.stamp() });
    if (!same(base.settings, next.settings)) this.settings = { v: 1, value: next.settings, clock: this.stamp() };
  }
  seed(state) {
    state.shortcuts.forEach((item, rank) => this.records.set(item.id, { v: 1, ...item, rank, deleted: false, clock: this.stamp() }));
    this.settings = { v: 1, value: state.settings, clock: this.stamp() };
  }
  async save(base, next) {
    base = validateState(base); next = validateState(next);
    if (!this.meta.joined) {
      // Before first join, local storage remains the source of truth.
      this.state = next;
    } else {
      // Apply only this tab's changes, preserving unrelated concurrent additions.
      this.capture(base, next);
      this.state = materialize(this.records, this.settings);
    }
    if (this.meta.enabled) { this.meta.pending = true; this.meta.phase = 'queued'; this.meta.detail = '本机已保存，等待提交给 Chrome'; }
    await this.persist();
    return this.result();
  }
  async enable(choice) {
    const raw = await this.sync.get(null);
    const cloud = decodeCloud(raw);
    this.observe(cloud);
    if (!this.meta.joined) {
      const remote = cloud.exists ? materialize(cloud.records, cloud.settings) : null;
      if (remote && !choice && !isStarter(this.state) && !same(this.state, remote)) return this.result({ needsChoice: true, localCount: this.state.shortcuts.length, remoteCount: remote.shortcuts.length });
      if (choice && !['merge', 'cloud', 'local'].includes(choice)) throw new Error('请选择有效的同步方式');
      const before = structuredClone(this.state);
      this.records = new Map(cloud.records); this.settings = cloud.settings;
      if (remote && (choice === 'cloud' || (!choice && isStarter(this.state)))) this.state = remote;
      else if (remote && choice !== 'local') {
        this.state = mergeFirstJoin(this.state, remote);
        // Existing remote entries keep their clocks. Only append local-only data.
        const known = new Set(cloud.records.keys());
        this.state.shortcuts.forEach((item, rank) => { if (!known.has(item.id)) this.records.set(item.id, { v: 1, ...item, rank, deleted: false, clock: this.stamp() }); });
      } else {
        const wanted = new Set(this.state.shortcuts.map(item => item.id));
        for (const id of this.records.keys()) if (!wanted.has(id)) this.records.set(id, { v: 1, id, deleted: true, clock: this.stamp() });
        this.seed(this.state);
      }
      this.meta.joined = true; this.meta.enabled = true; this.meta.pending = true;
      this.hasBackup = true;
      await this.persist({ [BACKUP_KEY]: before });
    } else { this.meta.enabled = true; this.meta.pending = true; await this.persist(); }
    return this.flush();
  }
  async disable() {
    this.meta.enabled = false; this.meta.phase = 'off'; this.meta.detail = '本机同步已关闭';
    await this.persist(); return this.result();
  }
  async backup() { return { backup: (await this.local.get(BACKUP_KEY))[BACKUP_KEY] ?? null }; }
  async flush() {
    if (!this.meta.enabled) return this.result();
    try {
      const raw = await this.sync.get(null);
      const cloud = decodeCloud(raw);
      this.observe(cloud);
      for (const id of cloud.records.keys()) this.knownRemote.add(id);
      const before = this.state;
      const merged = mergeRecords(this.records, cloud.records);
      // A local item that never reached sync needs no deletion marker there.
      for (const [id, record] of merged) if (record.deleted && !this.knownRemote.has(id)) merged.delete(id);
      const settings = winner(this.settings, cloud.settings);
      const state = materialize(merged, settings);
      this.records = merged; this.settings = settings; this.state = state;
      if (!same(before, this.state)) this.meta.lastReceived = this.now();
      const changes = {};
      for (const [id, record] of this.records) if (!same(record, cloud.records.get(id))) changes[SITE_PREFIX + id] = record;
      if (this.settings && !same(this.settings, cloud.settings)) changes[SETTINGS_KEY] = this.settings;
      this.meta.pending = Object.keys(changes).length > 0;
      // Persist merged data first. Quota/network errors cannot discard local work.
      await this.persist();
      this.meta.usedBytes = checkQuota({ ...raw, ...changes });
      if (this.meta.pending) {
        await this.sync.set(changes);
        for (const key of Object.keys(changes)) if (key.startsWith(SITE_PREFIX)) this.knownRemote.add(key.slice(SITE_PREFIX.length));
        this.meta.lastSubmitted = this.now();
      }
      this.meta.pending = false; this.meta.phase = 'ready';
      this.meta.detail = this.meta.lastSubmitted ? '已提交给 Chrome 同步' : '已读取 Chrome 同步数据';
      await this.persist();
    } catch (error) {
      this.meta.pending = true; this.meta.phase = 'error';
      this.meta.detail = /QUOTA|MAX_ITEMS|限额|100 KB|8 KB|空间/i.test(error.message) ? '同步容量或写入频率达到 Chrome 限额，本机数据已保存；稍后重试或减少同步内容' : `同步暂不可用，本机数据已保存：${String(error.message).slice(0, 160)}`;
      await this.persist();
    }
    return this.result();
  }
}
