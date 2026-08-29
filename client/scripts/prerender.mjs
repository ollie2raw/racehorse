import { readFile, writeFile } from 'node:fs/promises';
import { NOINDEX, crawlTargets, isIndexable, navLabel } from './prerenderNav.mjs';
import { PRERENDER_ROUTES as routes } from './prerenderRoutes.mjs';
import { HOW_TO_PLAY_ARTICLE } from '../src/learn/howToPlay/howToPlayArticleContent.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(clientDir, 'dist');
const indexPath = path.join(distDir, 'index.html');
const siteOrigin = 'https://playracehorse.com';


/** Routes whose prerendered shell carries a full article rather than a lede. */
const ARTICLES = {
  '/learn/how-to-play': HOW_TO_PLAY_ARTICLE,
};

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function replaceMeta(html, selector, value) {
  const escaped = escapeHtml(value);
  const pattern = new RegExp(`(<meta ${selector} content=")[^"]*("\\s*/?>)`);
  if (!pattern.test(html)) throw new Error(`Missing metadata template: ${selector}`);
  return html.replace(pattern, `$1${escaped}$2`);
}

function renderRoute(template, route) {
  const url = `${siteOrigin}${route.path}`;
  const image = `${siteOrigin}${route.image}`;
  // Every indexable route links to every other, so a crawler reaching any page
  // can walk the whole site. Not aria-hidden: React replaces this on hydrate,
  // but until it does this nav is the only way through the site without JS.
  const links = crawlTargets(routes, route.path)
    .map((other) => `<li><a href="${other.path}">${escapeHtml(navLabel(other))}</a></li>`)
    .join('');

  // Routes with long-form content serve it in the shell too, so the served
  // HTML carries the same words the hydrated page shows. Everything else
  // keeps its short lede.
  const article = ARTICLES[route.path];
  const bodyHtml = article
    ? `<p>${escapeHtml(article.standfirst)}</p>` +
      article.sections
        .map(
          (section) =>
            `<section id="${section.id}"><h2>${escapeHtml(section.heading)}</h2>` +
            section.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('') +
            `</section>`,
        )
        .join('')
    : `<p>${escapeHtml(route.body)}</p>`;

  const content =
    `<main class="prerendered-page">` +
    `<p>Racehorse Dominoes</p>` +
    `<h1>${escapeHtml(route.heading)}</h1>` +
    bodyHtml +
    `<nav aria-label="Racehorse Dominoes pages"><ul>${links}</ul></nav>` +
    `</main>`;

  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${url}" />`)
    .replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root">${content}</div>`);

  html = replaceMeta(html, 'name="description"', route.description);
  html = replaceMeta(html, 'property="og:title"', route.title);
  html = replaceMeta(html, 'property="og:description"', route.description);
  html = replaceMeta(html, 'property="og:image"', image);
  html = replaceMeta(html, 'property="og:url"', url);
  html = replaceMeta(html, 'name="twitter:title"', route.title);
  html = replaceMeta(html, 'name="twitter:description"', route.description);
  html = replaceMeta(html, 'name="twitter:image"', image);
  return html;
}

const template = await readFile(indexPath, 'utf8');
for (const route of routes) {
  const outputPath = route.path === '/'
    ? indexPath
    : path.join(distDir, route.output ?? `${route.path.slice(1)}.html`);
  await writeFile(outputPath, renderRoute(template, route));
}

/*
 * Crawl surface.
 *
 * Generated from the same route list rather than kept as static files, so the
 * sitemap cannot drift from what is actually prerendered. Without these,
 * Vercel's /(.*) catch-all serves index.html for /robots.txt and /sitemap.xml
 * with a text/html content type, and search engines cannot crawl the site at
 * all.
 */

const indexable = routes.filter(isIndexable);

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...indexable.map((route) => {
    const loc = `${siteOrigin}${route.path === '/' ? '/' : route.path}`;
    // Leaderboards turn over daily; the rest are stable content pages.
    const changefreq = route.path.includes('leaderboard') || route.path.startsWith('/daily') ? 'daily' : 'weekly';
    const priority = route.path === '/' ? '1.0' : '0.7';
    return `  <url><loc>${loc}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
  }),
  '</urlset>',
  '',
].join('\n');

await writeFile(path.join(distDir, 'sitemap.xml'), sitemap);

const robots = [
  'User-agent: *',
  'Allow: /',
  '',
  '# Per-user and per-match pages carry no indexable content.',
  ...[...NOINDEX].map((route) => `Disallow: ${route}`),
  '',
  `Sitemap: ${siteOrigin}/sitemap.xml`,
  '',
].join('\n');

await writeFile(path.join(distDir, 'robots.txt'), robots);

console.log(`Prerendered ${routes.length} routes for ${siteOrigin}.`);
console.log(`Wrote sitemap.xml (${indexable.length} urls) and robots.txt.`);
