import { META_KEY } from './sync-model.js';

export async function syncRequest(action, data = {}) {
  const response = await chrome.runtime.sendMessage({ moreSlotsSync: true, action, ...data });
  if (!response?.ok) throw new Error(response?.error || '同步后台暂不可用，请刷新扩展后重试');
  return response;
}

export function installSyncUI({ extensionMode, onResult, notify }) {
  const $ = id => document.getElementById(id);
  let current = null;
  let busy = false;
  function paint(status) {
    current = status;
    $('sync-status').textContent = status.detail;
    $('sync-status').classList.toggle('error', status.phase === 'error');
    $('sync-toggle').textContent = status.enabled ? '关闭本机同步' : '启用同步';
    $('sync-toggle').disabled = busy || !extensionMode;
    $('sync-now').disabled = busy || !status.enabled;
    $('sync-backup').hidden = !status.hasBackup;
    $('sync-usage').textContent = status.enabled ? `同步占用 ${(status.usedBytes / 1024).toFixed(1)} KB / 100 KB${status.pending ? ' · 有待提交改动' : ''}` : '';
    $('sync-time').textContent = status.lastSubmitted ? `上次提交：${new Date(status.lastSubmitted).toLocaleString()}。接收情况以另一台设备为准。` : '';
  }
  async function refresh() {
    if (!extensionMode) { paint({ detail: '加载扩展后可使用 Chrome 同步', enabled: false, hasBackup: false }); return; }
    try { const result = await syncRequest('status'); paint(result.status); }
    catch (error) { $('sync-status').textContent = error.message; }
  }
  async function act(action, data) {
    if (busy) return;
    busy = true;
    if (current) paint(current);
    try {
      const result = await syncRequest(action, data);
      paint(result.status);
      if (result.needsChoice) {
        $('sync-choice-count').textContent = `本机 ${result.localCount} 个快捷方式，Chrome 同步中 ${result.remoteCount} 个。请选择首次同步方式。`;
        $('sync-choice-dialog').showModal();
      } else {
        $('sync-choice-dialog').close();
        onResult(result);
        notify(result.status.phase === 'error' ? result.status.detail : action === 'disable' ? '本机同步已关闭' : '已检查 Chrome 同步存储');
      }
    } catch (error) { paint({ ...(current ?? {}), phase: 'error', detail: error.message }); notify(error.message); }
    finally { busy = false; if (current) paint(current); }
  }
  $('sync-toggle').addEventListener('click', () => act(current?.enabled ? 'disable' : 'enable'));
  $('sync-now').addEventListener('click', () => act('sync'));
  document.querySelectorAll('[data-sync-choice]').forEach(button => button.addEventListener('click', () => act('enable', { choice: button.dataset.syncChoice })));
  $('sync-backup').addEventListener('click', async () => {
    try {
      const { backup } = await syncRequest('backup');
      if (!backup) return notify('没有启用前的备份');
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'more-slots-before-sync.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) { notify(error.message); }
  });
  $('open-chrome-sync').addEventListener('click', () => {
    if (extensionMode) chrome.tabs.create({ url: 'chrome://settings/syncSetup' }).catch(error => notify(error.message));
  });
  if (extensionMode) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[META_KEY]) refresh(); });
  refresh();
  return { refresh };
}
