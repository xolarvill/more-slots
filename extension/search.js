import { canRequestSuggestions, cleanHistory, localSuggestions, mergeSuggestions, searchDestination } from './search-model.js';

export function installSearch({ getState, extensionMode }) {
  const $ = id => document.getElementById(id);
  const input = $('search');
  const shell = $('search-shell');
  const list = $('search-options');
  const dropdown = $('search-dropdown');
  const status = $('search-status');
  const clearButton = $('clear-search-history');
  const historyKey = 'more-slots-search-history-v1';
  let history = [];
  let items = [];
  let active = -1;
  let generation = 0;
  let debounce;
  let request;
  let composing = false;
  let navigating = false;
  let previousQuery = '';

  async function loadHistory() {
    try {
      history = cleanHistory(extensionMode ? (await chrome.storage.local.get(historyKey))[historyKey] : JSON.parse(localStorage.getItem(historyKey) || '[]'));
    } catch { history = []; }
  }
  async function saveHistory() {
    if (extensionMode) await chrome.storage.local.set({ [historyKey]: history });
    else localStorage.setItem(historyKey, JSON.stringify(history));
  }
  function cancel() {
    clearTimeout(debounce);
    generation++;
    request?.abort();
    request = null;
  }
  function close() {
    cancel();
    dropdown.hidden = true;
    shell.classList.remove('suggestions-open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }
  function setActive(index) {
    active = index;
    [...list.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
    if (index >= 0 && list.children[index]) {
      input.setAttribute('aria-activedescendant', list.children[index].id);
      list.children[index].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function paint(next, message) {
    // Preserve the keyboard selection if late network results arrive.
    const previous = items[active];
    items = next;
    list.replaceChildren();
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'search-option';
      row.id = `search-option-${index}`;
      row.setAttribute('role', 'option');
      const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      symbol.setAttribute('viewBox', '0 0 24 24');
      symbol.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(symbol.namespaceURI, 'path');
      path.setAttribute('d', item.type === 'history' ? 'M4 8V3m0 5h5M4 8a9 9 0 1 1-1 7M12 7v5l3 2' : item.type === 'shortcut' || item.type === 'url' ? 'M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2M14 11a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2' : 'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0');
      symbol.append(path);
      const label = document.createElement('span');
      label.className = 'search-option-label';
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'search-option-detail';
      detail.textContent = item.detail;
      row.append(symbol, label, detail);
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('pointermove', () => setActive(index));
      row.addEventListener('click', () => navigate(item.value));
      list.append(row);
    });
    status.textContent = message;
    clearButton.hidden = history.length === 0;
    dropdown.hidden = false;
    shell.classList.add('suggestions-open');
    input.setAttribute('aria-expanded', 'true');
    const retained = previous ? items.findIndex(item => item.type === previous.type && item.value === previous.value) : -1;
    setActive(retained);
  }
  function update() {
    cancel();
    if (composing || document.activeElement !== input) return;
    const query = input.value.trim();
    if (query !== previousQuery) active = -1;
    previousQuery = query;
    const local = localSuggestions(query, getState().shortcuts, history);
    const online = getState().settings.liveSuggestions && canRequestSuggestions(query);
    const localMessage = query ? 'Enter 搜索 · ↑↓ 选择' : history.length ? '最近搜索与快捷方式' : '常用快捷方式 · 输入以搜索';
    paint(local, localMessage);
    if (!online) return;
    const current = generation;
    debounce = setTimeout(async () => {
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const url = new URL('https://suggestqueries.google.com/complete/search');
        url.searchParams.set('client', 'chrome');
        url.searchParams.set('hl', navigator.language || 'zh-CN');
        url.searchParams.set('q', query);
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('Suggestion service unavailable');
        const text = await response.text();
        if (text.length > 65536) throw new Error('Suggestion response too large');
        const payload = JSON.parse(text);
        if (current !== generation || document.activeElement !== input) return;
        paint(mergeSuggestions(local, payload), localMessage);
      } catch {
        if (current === generation && document.activeElement === input) paint(local, 'Google 联想暂不可用 · 可继续搜索');
      } finally { clearTimeout(timeout); if (request === controller) request = null; }
    }, 200);
  }
  async function navigate(value, aiMode = false) {
    if (navigating) return;
    const destination = searchDestination(value, aiMode);
    if (!destination) { input.focus(); update(); return; }
    navigating = true;
    close();
    $('search-form').setAttribute('aria-busy', 'true');
    if (aiMode) {
      const button = shell.querySelector('.ai-mode');
      button.querySelector('span').textContent = '正在打开…';
      button.disabled = true;
    }
    const query = String(value).trim();
    if (destination.isSearch && query.length <= 200) {
      history = cleanHistory([query, ...history]);
      // Save before navigating so that the next new tab can offer this search.
      try { await saveHistory(); } catch { /* Storage errors must not prevent search. */ }
    }
    location.assign(destination.url);
  }
  input.addEventListener('focus', update);
  input.addEventListener('input', update);
  input.addEventListener('compositionstart', () => { composing = true; cancel(); });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (dropdown.hidden) update();
      if (items.length) setActive(active < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      navigate(!dropdown.hidden && active >= 0 ? items[active].value : input.value);
    } else if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') close();
  });
  $('search-form').addEventListener('submit', event => {
    event.preventDefault();
    if (composing) return;
    const ai = event.submitter?.value === '50';
    const selected = !ai && !dropdown.hidden && active >= 0 ? items[active] : null;
    navigate(selected?.value ?? input.value, ai);
  });
  document.addEventListener('pointerdown', event => { if (!shell.contains(event.target)) close(); });
  shell.addEventListener('focusout', () => queueMicrotask(() => { if (!shell.contains(document.activeElement)) close(); }));
  clearButton.addEventListener('click', async () => {
    const previous = history;
    history = [];
    try { await saveHistory(); } catch { history = previous; status.textContent = '清除失败，请重试'; return; }
    input.focus();
    update();
  });
  window.addEventListener('pageshow', () => {
    navigating = false;
    $('search-form').removeAttribute('aria-busy');
    const button = shell.querySelector('.ai-mode');
    button.disabled = false;
    button.querySelector('span').textContent = 'AI Mode';
  });
  loadHistory().then(() => { if (document.activeElement === input) update(); });
  return { refresh: update };
}
