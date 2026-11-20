/**
 * The scripts index.html loads before first paint: the entry module plus every modulepreload.
 * Each tag is matched first and its attributes read afterwards, so attribute order and quote style do not matter
 * (a Vite upgrade or a transformIndexHtml plugin may change either without changing what the browser loads).
 */
const TAG = /<(script|link)\b[^>]*>/gi;

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

export function firstPaintScripts(html) {
  const files = [];
  for (const [tag, name] of html.matchAll(TAG)) {
    const kind = name.toLowerCase();
    if (kind === 'script' && attr(tag, 'type')?.toLowerCase() === 'module') {
      const src = attr(tag, 'src');
      if (src) files.push(src);
    } else if (kind === 'link' && attr(tag, 'rel')?.toLowerCase().split(/\s+/).includes('modulepreload')) {
      const href = attr(tag, 'href');
      if (href) files.push(href);
    }
  }
  return files;
}
