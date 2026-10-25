export function bookmarkLabel(node) {
  return node.title?.trim() || (node.url ? node.url : '未命名文件夹');
}

export function bookmarkUrl(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:', 'file:', 'chrome:'].includes(url.protocol) || (url.protocol === 'about:' && url.pathname === 'blank')) return url.href;
  } catch { /* An invalid bookmark remains visible but cannot execute. */ }
  return null;
}

export function bookmarkView(tree) {
  const roots = tree.flatMap(root => root.children ?? []);
  const typed = roots.filter(root => root.folderType === 'bookmarks-bar');
  // Older Chrome versions have no folderType. Their first user root is the bar.
  const bars = typed.length ? typed : roots.some(root => root.folderType) ? [] : roots.filter(root => !root.unmodifiable).slice(0, 1);
  const mixed = bars.length > 1;
  const rootTitles = new Map();
  for (const root of roots) {
    const duplicate = roots.some(other => other !== root && bookmarkLabel(other) === bookmarkLabel(root));
    rootTitles.set(root.id, `${bookmarkLabel(root)}${duplicate ? root.syncing === true ? '（账号）' : root.syncing === false ? '（本机）' : '' : ''}`);
  }
  const barItems = bars.flatMap(root => (root.children ?? []).map(node => ({
    node,
    label: `${bookmarkLabel(node)}${mixed && bars.some(other => other !== root && (other.children ?? []).some(child => bookmarkLabel(child) === bookmarkLabel(node))) ? root.syncing === true ? '（账号）' : '（本机）' : ''}`
  })));
  return { roots, rootTitles, barItems };
}
