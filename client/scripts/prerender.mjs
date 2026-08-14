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
  {
    path: '/multiplayer',
    title: 'Multiplayer | Racehorse Dominoes',
    description: 'Play competitive Racehorse Dominoes online against other players.',
    heading: 'Racehorse Multiplayer',
    body: 'Find an opponent and play competitive Racehorse Dominoes online.',
    image: homeImage,
  },
  {
    path: '/multiplayer/private',
    output: 'multiplayer-private.html',
    title: 'Private Match | Racehorse Dominoes',
    description: 'Create or join a private Racehorse Dominoes room and play with friends.',
    heading: 'Private Racehorse Match',
    body: 'Create a private room or join a friend with a room code.',
    image: homeImage,
  },
  {
    path: '/solo/fritz',
    output: 'solo-fritz.html',
    title: 'Play vs Fritz | Racehorse Dominoes',
    description: 'Choose a Fritz difficulty and play a strategic solo Racehorse Dominoes match.',
    heading: 'Play vs Fritz',
    body: 'Choose your Fritz difficulty and deal size, then start a solo match.',
    image: '/dailyfritznew.png',
  },
  {
    path: '/solo/ghost',
    output: 'solo-ghost.html',
    title: 'Ghost Mode | Racehorse Dominoes',
    description: 'Challenge a Racehorse Dominoes ghost modeled on another player’s decisions.',
    heading: 'Ghost Mode',
    body: 'Choose a player ghost and test your strategy against their style.',
    image: homeImage,
  },
  {
    path: '/social',
    title: 'Social | Racehorse Dominoes',
    description: 'Follow Racehorse Dominoes players, see recent activity, and explore the global rankings.',
    heading: 'Racehorse Social',
    body: 'Follow players, see recent activity, and explore the competitive community.',
    image: homeImage,
  },
  {
    path: '/players',
    output: 'players.html',
    title: 'Player Profile | Racehorse Dominoes',
    description: 'View a Racehorse Dominoes player profile, rating, record, and recent competitive activity.',
    heading: 'Racehorse Player Profile',
    body: 'View player ratings, records, and recent competitive activity.',
    image: homeImage,
  },
  {
    path: '/daily-fritz/leaderboard',
    output: 'daily-fritz-leaderboard.html',
    title: 'Daily Fritz Leaderboard | Racehorse Dominoes',
    description: 'Compare today’s Daily Fritz results with Racehorse Dominoes players around the world.',
    heading: 'Daily Fritz Leaderboard',
    body: 'See how today’s shared Daily Fritz set played out across the field.',
    image: '/dailyfritznew.png',
  },
  {
    path: '/daily/leaderboard',
    output: 'daily-leaderboard.html',
    title: 'Daily Puzzle Leaderboard | Racehorse Dominoes',
    description: 'Compare scores from today’s Racehorse Dominoes Daily Puzzle ladder.',
    heading: 'Daily Puzzle Leaderboard',
    body: 'See today’s top Daily Puzzle ladder scores.',
    image: defaultImage,
  },
  {
    path: '/learn/how-to-play',
    output: 'learn-how-to-play.html',
    title: 'How to Play Racehorse Dominoes',
    description: 'Learn the rules, scoring, and core strategy of Racehorse Dominoes.',
    heading: 'How to Play Racehorse Dominoes',
    body: 'Learn Racehorse scoring, turns, draws, and the decisions that shape each hand.',
    image: homeImage,
  },
  {
    path: '/tournament/detail',
    output: 'tournament-detail.html',
    title: 'Tournament | Racehorse Dominoes',
    description: 'View a Racehorse Dominoes tournament table, players, and match schedule.',
    heading: 'Racehorse Tournament',
    body: 'View the tournament table, players, and match schedule.',
    image: homeImage,
  },
  {
    path: '/tournament/result',
    output: 'tournament-result.html',
    title: 'Tournament Result | Racehorse Dominoes',
    description: 'View the result of a Racehorse Dominoes tournament match.',
    heading: 'Tournament Match Result',
    body: 'Review the completed tournament match result.',
    image: homeImage,
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
  const content = `<main class="prerendered-page" aria-hidden="true"><p>Racehorse Dominoes</p><h1>${escapeHtml(route.heading)}</h1><p>${escapeHtml(route.body)}</p><p><a href="/">Explore Racehorse Dominoes</a></p></main>`;

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

console.log(`Prerendered ${routes.length} routes for ${siteOrigin}.`);
