export function iconSources(pageUrl, runtimeUrl) {
  const page = new URL(pageUrl);
  if (!['https:', 'http:'].includes(page.protocol)) return [];
  const sources = [];
  if (runtimeUrl) {
    for (const url of new Set([page.href, `${page.origin}/`])) {
      const source = new URL(runtimeUrl);
      source.searchParams.set('pageUrl', url);
      source.searchParams.set('size', '32');
      sources.push({ url: source.href, cached: true });
    }
  }
  sources.push({ url: `${page.origin}/favicon.ico`, cached: false });
  return sources;
}

let defaultSignature;
function signature(image) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32);
    return Array.from(context.getImageData(0, 0, 32, 32).data).join(',');
  } catch { return null; }
}
function load(image, url) {
  return new Promise(resolve => {
    const finish = success => { image.onload = image.onerror = null; clearTimeout(timeout); resolve(success); };
    const timeout = setTimeout(() => finish(false), 3500);
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}
async function missingIconSignature(runtimeUrl) {
  if (!defaultSignature) defaultSignature = (async () => {
    const sample = new Image();
    sample.draggable = false;
    const source = iconSources('https://more-slots-favicon-missing.invalid/', runtimeUrl)[0];
    return await load(sample, source.url) ? signature(sample) : null;
  })();
  return defaultSignature;
}

export function mountFavicon(circle, item, runtimeUrl) {
  const fallback = document.createElement('span');
  fallback.textContent = Array.from(item.name)[0].toUpperCase();
  const image = new Image();
  image.alt = '';
  image.draggable = false;
  image.hidden = true;
  image.referrerPolicy = 'no-referrer';
  circle.append(fallback, image);
  (async () => {
    await Promise.resolve(); // The caller appends the tile during this render.
    const missing = runtimeUrl ? await missingIconSignature(runtimeUrl) : null;
    for (const source of iconSources(item.url, runtimeUrl)) {
      if (!circle.isConnected) return;
      if (!await load(image, source.url)) continue;
      // Chrome may successfully return its generic globe for an uncached site.
      // Do not mistake that placeholder for the website's actual favicon.
      if (source.cached && missing && signature(image) === missing) continue;
      if (!circle.isConnected) return;
      image.hidden = false;
      fallback.hidden = true;
      image.dataset.source = source.cached ? 'chrome' : 'website';
      return;
    }
    image.remove();
  })();
}
