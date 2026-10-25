export function reorderVisible(shortcuts, orderedIds) {
  const ids = new Set(orderedIds);
  const lookup = new Map(shortcuts.map(item => [item.id, item]));
  if (ids.size !== orderedIds.length || orderedIds.some(id => !lookup.has(id))) throw new Error('快捷方式顺序无效');
  let index = 0;
  return shortcuts.map(item => ids.has(item.id) ? lookup.get(orderedIds[index++]) : item);
}

export function installReordering(grid, { onStart, onReorder }) {
  let gesture = null;
  let suppressClickUntil = 0;
  let frame;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const tiles = () => [...grid.querySelectorAll('.shortcut[data-id]')];
  const ids = () => tiles().map(tile => tile.dataset.id);
  function clearClasses() {
    grid.classList.remove('is-reordering');
    grid.querySelectorAll('.drag-placeholder').forEach(tile => tile.classList.remove('drag-placeholder'));
  }
  function restore(order) {
    const lookup = new Map(tiles().map(tile => [tile.dataset.id, tile]));
    const add = grid.querySelector('.shortcut:not([data-id])');
    for (const id of order) if (lookup.has(id)) grid.insertBefore(lookup.get(id), add);
  }
  function finish(cancelled = false) {
    const current = gesture;
    if (!current) return;
    gesture = null;
    cancelAnimationFrame(frame);
    if (grid.hasPointerCapture(current.pointerId)) grid.releasePointerCapture(current.pointerId);
    current.ghost?.remove();
    clearClasses();
    if (!current.started) return;
    suppressClickUntil = performance.now() + 500;
    if (cancelled) { restore(current.original); return; }
    const next = ids();
    if (next.some((id, index) => id !== current.original[index])) onReorder(next);
  }
  function rearrange() {
    const current = gesture;
    if (!current?.started) return;
    const scrollOffset = window.scrollY - current.scrollY;
    let nearest = 0;
    let distance = Infinity;
    current.slots.forEach((slot, index) => {
      const nextDistance = (current.x - slot.x) ** 2 + (current.y - (slot.y - scrollOffset)) ** 2;
      if (nextDistance < distance) { distance = nextDistance; nearest = index; }
    });
    const previous = tiles();
    const from = previous.indexOf(current.tile);
    if (from === nearest) return;
    const before = new Map(previous.map(tile => [tile, tile.getBoundingClientRect()]));
    const reordered = previous.filter(tile => tile !== current.tile);
    reordered.splice(nearest, 0, current.tile);
    const add = grid.querySelector('.shortcut:not([data-id])');
    reordered.forEach(tile => grid.insertBefore(tile, add));
    if (!reduceMotion.matches) for (const tile of reordered) {
      if (tile === current.tile) continue;
      tile.getAnimations().forEach(animation => animation.cancel());
      const old = before.get(tile);
      const next = tile.getBoundingClientRect();
      if (old.x !== next.x || old.y !== next.y) tile.animate([{ transform: `translate(${old.x - next.x}px, ${old.y - next.y}px)` }, { transform: 'translate(0, 0)' }], { duration: 140, easing: 'ease-out' });
    }
  }
  function autoScroll() {
    if (!gesture?.started) return;
    const edge = 64;
    const speed = gesture.y < edge ? -Math.min(18, (edge - gesture.y) / 3) : gesture.y > innerHeight - edge ? Math.min(18, (gesture.y - innerHeight + edge) / 3) : 0;
    if (speed) { window.scrollBy(0, speed); rearrange(); }
    frame = requestAnimationFrame(autoScroll);
  }
  function start(event) {
    const current = gesture;
    const tile = current.tile;
    const rect = tile.getBoundingClientRect();
    current.started = true;
    current.original = ids();
    current.scrollY = window.scrollY;
    current.slots = tiles().map(tile => { const r = tile.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    current.offsetX = current.startX - rect.x;
    current.offsetY = current.startY - rect.y;
    current.ghost = tile.cloneNode(true);
    current.ghost.className = 'shortcut drag-ghost';
    current.ghost.removeAttribute('data-id');
    current.ghost.setAttribute('aria-hidden', 'true');
    current.ghost.style.width = `${rect.width}px`;
    document.body.append(current.ghost);
    tile.classList.add('drag-placeholder');
    grid.classList.add('is-reordering');
    grid.setPointerCapture(event.pointerId);
    onStart?.();
    frame = requestAnimationFrame(autoScroll);
  }
  grid.addEventListener('pointerdown', event => {
    if (!gesture) suppressClickUntil = 0;
    if (gesture || event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.pointerType === 'touch') return;
    const tile = event.target.closest('.shortcut[data-id]');
    if (!tile || !grid.contains(tile) || event.target.closest('button')) return;
    gesture = { tile, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, started: false };
  });
  window.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.started && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 6) start(event);
    if (!gesture?.started) return;
    event.preventDefault();
    gesture.ghost.style.left = `${event.clientX - gesture.offsetX}px`;
    gesture.ghost.style.top = `${event.clientY - gesture.offsetY}px`;
    rearrange();
  }, { passive: false });
  window.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const rect = grid.getBoundingClientRect();
    const outside = event.clientX < rect.left - 40 || event.clientX > rect.right + 40 || event.clientY < rect.top - 40 || event.clientY > rect.bottom + 40;
    finish(outside);
  });
  grid.addEventListener('lostpointercapture', () => finish(true));
  window.addEventListener('pointercancel', () => finish(true));
  window.addEventListener('blur', () => finish(true));
  window.addEventListener('resize', () => finish(true));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') finish(true); });
  grid.addEventListener('dragstart', event => event.preventDefault());
  grid.addEventListener('click', event => {
    if (event.detail > 0 && performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = 0;
    }
  }, true);
  return { cancel: () => finish(true) };
}
