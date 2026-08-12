import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(clientDir, 'dist');
const indexPath = path.join(distDir, 'index.html');
const siteOrigin = 'https://playracehorse.com';

const homeImage = '/homeOG.png';
const defaultImage = '/dailypuzzleHOMEBG.png';
const routes = [
  {
    path: '/',
    title: 'Racehorse Dominoes | Daily Strategy Game',
    description: 'Play Racehorse Dominoes with daily strategy challenges, competitive modes, guided learning, and Fritz.',
    heading: 'Daily dominoes, built for strategy.',
    body: 'Play today’s Daily Fritz set, solve the Daily Puzzle, learn the game, or compete online.',
    image: homeImage,
  },
  {
    path: '/daily-fritz',
    title: 'Daily Fritz | Racehorse Dominoes',
    description: 'Play one shared best-of-three Racehorse Dominoes set against Fritz each day and compare your result.',
    heading: 'Daily Fritz',
    body: 'One daily best-of-three set against Fritz. The same deals for every player.',
    image: '/dailyfritznew.png',
  },
  {
    path: '/daily',
    title: 'Daily Puzzle | Racehorse Dominoes',
    description: 'Solve five daily Racehorse Dominoes positions and compare your strategy on the shared leaderboard.',
    heading: 'Daily Puzzle',
    body: 'Five daily puzzles. One shared strategy challenge.',
    image: defaultImage,
  },
  {
    path: '/solo',
    title: 'Single Player | Racehorse Dominoes',
    description: 'Practice Racehorse Dominoes against Fritz, sharpen your decisions, and build your game.',
    heading: 'Single Player',
    body: 'Choose a solo mode and sharpen your Racehorse Dominoes strategy.',
    image: '/dailyfritznew.png',
  },
  {
    path: '/journey',
    title: 'Journey | Racehorse Dominoes',
    description: 'Progress through structured Racehorse Dominoes challenges designed to build stronger strategic play.',
    heading: 'Racehorse Journey',
    body: 'Progress through focused challenges and build a stronger game.',
    image: defaultImage,
  },
  {
    path: '/learn',
    title: 'Learn Racehorse Dominoes',
    description: 'Learn Racehorse Dominoes through guided play, practical lessons, and focused position drills.',
    heading: 'Learn Racehorse Dominoes',
    body: 'Build your game with guided lessons, match coaching, and position drills.',
    image: defaultImage,
  },
  {
    path: '/tournament',
    title: 'Tournaments | Racehorse Dominoes',
    description: 'Create or join a Racehorse Dominoes tournament and compete through a full round-robin table.',
    heading: 'Racehorse Tournaments',
    body: 'Create or join a tournament and compete through the full table.',
    image: defaultImage,
  },
];

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
  const content = `<main class="prerendered-page"><p>Racehorse Dominoes</p><h1>${escapeHtml(route.heading)}</h1><p>${escapeHtml(route.body)}</p><p><a href="/">Explore Racehorse Dominoes</a></p></main>`;

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
    : path.join(distDir, `${route.path.slice(1)}.html`);
  await writeFile(outputPath, renderRoute(template, route));
}

console.log(`Prerendered ${routes.length} routes for ${siteOrigin}.`);
