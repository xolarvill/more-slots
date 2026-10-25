import { SyncEngine } from './sync-engine.js';
import { SITE_PREFIX, SETTINGS_KEY } from './sync-model.js';

const engine = new SyncEngine({ local: chrome.storage.local, sync: chrome.storage.sync });
let queue = Promise.resolve();
let timer;
function run(operation) {
  const result = queue.then(async () => { await engine.init(); return operation(); });
  queue = result.catch(() => {});
  return result;
}
function schedule() {
  clearTimeout(timer);
  chrome.alarms.create('more-slots-sync', { delayInMinutes: 1 });
  timer = setTimeout(() => {
    run(() => engine.flush()).then(result => { if (result.status.pending && result.status.enabled) chrome.alarms.create('more-slots-sync', { delayInMinutes: 1 }); }).catch(() => {});
  }, 1200);
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message?.moreSlotsSync || sender.id !== chrome.runtime.id) return false;
  run(async () => {
    switch (message.action) {
      case 'get': case 'status': return engine.result();
      case 'save': { const result = await engine.save(message.base, message.state); if (result.status.enabled) schedule(); return result; }
      case 'enable': return engine.enable(message.choice);
      case 'disable': clearTimeout(timer); await chrome.alarms.clear('more-slots-sync'); return engine.disable();
      case 'sync': return engine.flush();
      case 'backup': return engine.backup();
      default: throw new Error('未知同步操作');
    }
  }).then(result => {
    if (result.status?.enabled && result.status.pending && result.status.phase === 'error') chrome.alarms.create('more-slots-sync', { delayInMinutes: 1 });
    respond({ ok: true, ...result });
  }).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some(key => key === SETTINGS_KEY || key.startsWith(SITE_PREFIX))) run(() => { if (engine.meta.enabled) schedule(); }).catch(() => {});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'more-slots-sync') run(() => engine.flush()).then(result => { if (result.status.pending && result.status.enabled) chrome.alarms.create('more-slots-sync', { delayInMinutes: 1 }); }).catch(() => {});
});
function wake() { run(() => { if (engine.meta.enabled) schedule(); }).catch(() => {}); }
chrome.runtime.onInstalled.addListener(wake);
chrome.runtime.onStartup.addListener(wake);
// Also handles service-worker restarts after the last new-tab page closed.
wake();
