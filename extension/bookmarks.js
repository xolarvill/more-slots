import { bookmarkLabel, bookmarkUrl, bookmarkView } from './bookmark-model.js';

function glyph(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', kind === 'folder' ? 'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3z' : kind === 'chevron' ? 'm9 5 7 7-7 7' : kind === 'overflow' ? 'm5 6 6 6-6 6m7-12 6 6-6 6' : 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18');
  svg.append(path);
  return svg;
}

export function installBookmarks({ getState, extensionMode }) {
  const $ = id => document.getElementById(id);
  const bar = $('bookmark-bar');
  const strip = $('bookmark-items');
  const enable = $('enable-bookmarks');
  const hint = $('bookmark-hint');
  const overflow = $('bookmark-overflow');
  const all = $('all-bookmarks');
  const layer = $('bookmark-menus');
  let view = bookmarkView([]);
  let entries = [];
  let hiddenEntries = [];
  let menus = [];
  let trigger = null;
  let generation = 0;
  let listenersAttached = false;
  let scheduled;
  let hoverTimer;

  function closeFrom(depth, restore = false) {
    clearTimeout(hoverTimer);
    const removed = menus.splice(depth);
    for (const entry of removed) {
      entry.anchor?.setAttribute('aria-expanded', 'false');
      entry.element.remove();
    }
    if (!menus.length) {
      trigger?.setAttribute('aria-expanded', 'false');
      if (restore && trigger?.isConnected) trigger.focus();
      trigger = null;
    } else if (restore) removed[0]?.anchor?.focus();
  }
  const close = restore => closeFrom(0, restore);

  function iconFor(node) {
    if (!node.url) return glyph('folder');
    const span = document.createElement('span');
    span.className = 'bookmark-favicon';
    span.append(glyph('globe'));
    if (extensionMode && ['https:', 'http:'].includes(new URL(bookmarkUrl(node.url) || 'about:blank').protocol)) {
      const image = new Image();
      image.alt = '';
      image.draggable = false;
      image.hidden = true;
      image.onload = () => { image.hidden = false; span.querySelector('svg').setAttribute('hidden', ''); };
      image.onerror = () => image.remove();
      const url = new URL(chrome.runtime.getURL('/_favicon/'));
      url.searchParams.set('pageUrl', node.url);
      url.searchParams.set('size', '16');
      image.src = url.href;
      span.append(image);
    }
    return span;
  }
  async function manager() {
    close();
    if (extensionMode) {
      try { await chrome.tabs.create({ url: 'chrome://bookmarks/' }); }
      catch { hint.hidden = false; hint.textContent = '无法打开书签管理器，请从 Chrome 菜单打开'; }
    }
  }
  function itemElement(entry, depth) {
    const node = entry.node;
    const folder = !node.url;
    const url = node.url && bookmarkUrl(node.url);
    const element = document.createElement(folder || !url ? 'button' : 'a');
    element.className = depth < 0 ? 'bookmark-item' : 'bookmark-menu-item';
    if (depth >= 0) { element.setAttribute('role', 'menuitem'); element.tabIndex = -1; }
    if (element.tagName === 'BUTTON') element.type = 'button';
    const label = entry.label ?? bookmarkLabel(node);
    const text = document.createElement('span');
    text.className = 'bookmark-label';
    text.textContent = label;
    element.title = `${label}${node.url ? `\n${node.url}` : ''}`;
    element.append(iconFor(node), text);
    if (folder) {
      element.setAttribute('aria-haspopup', 'menu');
      element.setAttribute('aria-expanded', 'false');
      if (depth >= 0) element.append(glyph('chevron'));
      element.addEventListener('click', () => {
        const nextDepth = depth + 1;
        if (menus[nextDepth]?.anchor === element) closeFrom(nextDepth);
        else openMenu((node.children ?? []).map(child => ({ node: child })), element, nextDepth, true);
      });
      element.addEventListener('pointerenter', () => {
        clearTimeout(hoverTimer);
        if (depth < 0 && menus.length) openMenu((node.children ?? []).map(child => ({ node: child })), element, 0);
        else if (depth >= 0) hoverTimer = setTimeout(() => openMenu((node.children ?? []).map(child => ({ node: child })), element, depth + 1), 160);
      });
      element.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' && depth < 0 || event.key === 'ArrowRight' && depth >= 0) {
          event.preventDefault(); event.stopPropagation();
          openMenu((node.children ?? []).map(child => ({ node: child })), element, depth + 1, true);
        }
      });
    } else if (url) {
      element.href = url;
      element.draggable = false;
      if (getState().settings.newTab) { element.target = '_blank'; element.rel = 'noopener noreferrer'; }
      element.addEventListener('click', async event => {
        if (['chrome:', 'file:'].includes(new URL(url).protocol) && extensionMode) {
          event.preventDefault();
          try {
            if (event.ctrlKey || event.metaKey || event.shiftKey || getState().settings.newTab) await chrome.tabs.create({ url });
            else await chrome.tabs.update({ url });
          } catch { hint.hidden = false; hint.textContent = 'Chrome 不允许打开此书签，请检查地址或文件访问权限'; }
        }
        // Removing the clicked anchor synchronously can cancel normal navigation.
        setTimeout(() => close(), 0);
      });
      element.addEventListener('pointerenter', () => { clearTimeout(hoverTimer); if (depth >= 0) closeFrom(depth + 1); });
    } else {
      element.disabled = true;
      element.title += '\n此类书签不支持在扩展中执行';
    }
    return element;
  }
  function openMenu(items, anchor, depth = 0, focus = false, showManager = false) {
    closeFrom(depth);
    if (depth === 0) trigger = anchor;
    const menu = document.createElement('div');
    menu.className = 'bookmark-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', anchor.textContent.trim() || anchor.getAttribute('aria-label') || '书签');
    for (const item of items) menu.append(itemElement(item, depth));
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'bookmark-empty';
      empty.textContent = '此文件夹为空';
      menu.append(empty);
    }
    if (showManager) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'bookmark-menu-item bookmark-manager';
      button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
      button.textContent = '打开书签管理器';
      button.addEventListener('click', manager);
      menu.append(button);
    }
    layer.append(menu);
    anchor.setAttribute('aria-expanded', 'true');
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = depth ? rect.right - 2 : rect.left;
    if (left + width > innerWidth - 8) left = depth ? rect.left - width + 2 : innerWidth - width - 8;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, Math.min(depth ? rect.top : rect.bottom + 3, innerHeight - height - 8))}px`;
    menus.push({ element: menu, anchor });
    menu.addEventListener('keydown', event => {
      const choices = [...menu.querySelectorAll('[role=menuitem]:not(:disabled)')];
      const index = choices.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        choices[next]?.focus();
      } else if (event.key === 'ArrowLeft' && depth > 0) { event.preventDefault(); event.stopPropagation(); closeFrom(depth, true); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === 'Tab') close();
    });
    if (focus) menu.querySelector('[role=menuitem]:not(:disabled)')?.focus();
  }
  function layout() {
    if (bar.hidden || !entries.length) { overflow.hidden = true; return; }
    entries.forEach(entry => { entry.element.hidden = false; });
    overflow.hidden = true;
    const total = entries.reduce((sum, entry) => sum + entry.element.getBoundingClientRect().width + 2, 0);
    if (total > strip.clientWidth) overflow.hidden = false;
    const available = strip.clientWidth;
    let used = 0;
    hiddenEntries = [];
    for (const entry of entries) {
      used += entry.element.getBoundingClientRect().width + 2;
      entry.element.hidden = used > available;
      if (entry.element.hidden) hiddenEntries.push(entry);
    }
    overflow.hidden = hiddenEntries.length === 0;
  }
  function showPrompt(message) {
    close();
    entries = []; strip.replaceChildren(); overflow.hidden = all.hidden = true;
    hint.hidden = enable.hidden = false;
    hint.textContent = message;
  }
  function attachListeners() {
    if (listenersAttached || !chrome.bookmarks) return;
    listenersAttached = true;
    const refreshSoon = () => { clearTimeout(scheduled); scheduled = setTimeout(refresh, 100); };
    for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) chrome.bookmarks[event]?.addListener(refreshSoon);
  }
  async function refresh() {
    const current = ++generation;
    close();
    bar.hidden = !getState().settings.showBookmarks;
    if (bar.hidden) return;
    if (!extensionMode) { showPrompt('加载扩展后，可在这里显示 Chrome 书签'); enable.hidden = true; return; }
    try {
      const granted = await chrome.permissions.contains({ permissions: ['bookmarks'] });
      if (current !== generation) return;
      if (!granted) { showPrompt('只在新标签页显示你的 Chrome 书签'); return; }
      attachListeners();
      const tree = await chrome.bookmarks.getTree();
      if (current !== generation) return;
      view = bookmarkView(tree);
      hint.hidden = enable.hidden = true;
      all.hidden = false;
      strip.replaceChildren();
      entries = view.barItems.map(entry => {
        const element = itemElement(entry, -1);
        strip.append(element);
        return { ...entry, element };
      });
      if (!entries.length) { hint.hidden = false; hint.textContent = '书签栏还没有书签，可从「所有书签」查看'; }
      layout();
    } catch { if (current === generation) showPrompt('暂时无法读取书签，请重新启用'); }
  }
  enable.addEventListener('click', async () => {
    try {
      const granted = await chrome.permissions.request({ permissions: ['bookmarks'] });
      if (granted) await refresh();
      else hint.textContent = '尚未授权；点击「启用书签栏」可重新选择';
    } catch { hint.textContent = '无法启用书签栏，请稍后重试'; }
  });
  all.addEventListener('click', () => {
    if (menus[0]?.anchor === all) close(true);
    else openMenu(view.roots.map(node => ({ node, label: view.rootTitles.get(node.id) })), all, 0, true, true);
  });
  overflow.addEventListener('click', () => {
    if (menus[0]?.anchor === overflow) close(true);
    else openMenu(hiddenEntries, overflow, 0, true);
  });
  document.addEventListener('pointerdown', event => { if (!bar.contains(event.target) && !layer.contains(event.target)) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(true); });
  window.addEventListener('blur', () => close());
  window.addEventListener('resize', () => { close(); layout(); });
  new ResizeObserver(layout).observe(strip);
  if (extensionMode) {
    chrome.permissions.onAdded.addListener(permissions => { if (permissions.permissions?.includes('bookmarks')) refresh(); });
    chrome.permissions.onRemoved.addListener(permissions => { if (permissions.permissions?.includes('bookmarks')) refresh(); });
  }
  refresh();
  return { refresh };
}
