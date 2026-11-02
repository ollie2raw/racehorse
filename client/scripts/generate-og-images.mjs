/**
 * Builds the Open Graph cards referenced by scripts/prerender.mjs.
 *
 * These are committed artefacts, not build output: they must exist as real
 * files in public/ or Vercel's SPA catch-all serves index.html in their place,
 * and every link preview silently renders without an image.
 *
 * Run: node scripts/generate-og-images.mjs [og-journey.png ...]   (no arguments rebuilds every card)
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(clientDir, 'public');

const WIDTH = 1200;
const HEIGHT = 630;

/** Mode colour identities (AGENTS.md section 3). The three original cards keep the brand gold. */
const GOLD = '#E7B64A';
const SINGLE_PLAYER_PURPLE = '#9B6CFF';
const MULTIPLAYER_BLUE = '#3B82F6';
const LEARN_GREEN = '#4ADE80';
const TOURNAMENT_AMBER = '#F59E0B';

/** Facebook, X, LinkedIn and iMessage all read a 1.91:1 card. */
const CARDS = [
  {
    out: 'homeOG.png',
    art: 'dailypuzzleHOMEBG.webp',
    eyebrow: 'Racehorse Dominoes',
    title: 'Daily dominoes,\nbuilt for strategy.',
    kicker: 'playracehorse.com',
  },
  {
    out: 'dailyfritznew.png',
    art: 'dailyfritznew.webp',
    eyebrow: 'Daily Fritz',
    title: 'One set.\nEveryone plays it.',
    kicker: 'Best of three vs Fritz',
  },
  {
    out: 'dailypuzzleHOMEBG.png',
    art: 'dailypuzzleHOMEBG.webp',
    eyebrow: 'Daily Puzzle',
    title: 'Three puzzles.\nOne a day.',
    kicker: 'playracehorse.com',
  },
  // One card per mode, so a shared link says what is behind it instead of every page showing the home or Daily Puzzle card.
  {
    out: 'og-play-vs-fritz.png',
    art: 'fritz-robot.webp',
    artPosition: 'right center',
    artSize: 'auto 100%',
    eyebrow: 'Play vs Fritz',
    title: 'Take a seat.\nBeat Fritz.',
    kicker: 'Four difficulty levels, rookie to master',
    accent: SINGLE_PLAYER_PURPLE,
  },
  {
    out: 'og-ghost-mode.png',
    art: 'ghostmodeimage.webp',
    eyebrow: 'Ghost Mode',
    title: 'Race a ghost\nof a real player.',
    kicker: 'Modeled on real decisions',
    accent: SINGLE_PLAYER_PURPLE,
  },
  {
    out: 'og-multiplayer.png',
    art: 'NEWpuzzleBG.webp',
    eyebrow: 'Multiplayer',
    title: 'Play real people.\nRace to 60.',
    kicker: 'Quick match or a private room',
    accent: MULTIPLAYER_BLUE,
  },
  {
    out: 'og-learn.png',
    art: 'fritzwave.webp',
    artPosition: 'right center',
    artSize: 'auto 112%',
    eyebrow: 'Learn',
    title: 'Learn to read\nthe board.',
    kicker: 'Guided lessons and position drills',
    accent: LEARN_GREEN,
  },
  {
    out: 'og-journey.png',
    // fritz2.webp has a small generator sparkle in its bottom-right corner: anchored to the top and enlarged so the corner falls outside the card.
    art: 'fritz2.webp',
    artPosition: 'right top',
    artSize: 'auto 114%',
    eyebrow: 'Journey',
    title: 'Climb the trail.\nBeat Fritz.',
    kicker: 'Lessons, matches and a boss',
  },
  {
    out: 'og-tournament.png',
    art: 'dailyfritzimage.webp',
    eyebrow: 'Tournaments',
    title: 'Compete in live\ntournaments.',
    kicker: 'Live events, real brackets',
    accent: TOURNAMENT_AMBER,
  },
];

const asDataUri = async (file) => {
  const bytes = await readFile(path.join(publicDir, file));
  return `data:image/webp;base64,${bytes.toString('base64')}`;
};

const page = (card, artUri, logoUri) => `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Outfit:wght@500;600&display=swap" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box}
  body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#04070c;position:relative;
       font-family:'Outfit',sans-serif;color:#fff}
  .art{position:absolute;inset:0;background:url('${artUri}') ${card.artPosition ?? 'center'}/${card.artSize ?? 'cover'} no-repeat;opacity:.5}
  /* A scrim from the text side only, so the art still reads on the right. */
  .scrim{position:absolute;inset:0;background:
    linear-gradient(90deg,#04070c 26%,rgba(4,7,12,.86) 52%,rgba(4,7,12,.35) 100%)}
  .body{position:relative;height:100%;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between}
  .top{display:flex;align-items:center;gap:16px}
  .logo{width:56px;height:56px;object-fit:contain}
  .eyebrow{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:22px;
           letter-spacing:.22em;text-transform:uppercase;color:${card.accent ?? GOLD}}
  h1{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:82px;line-height:.96;
     letter-spacing:-.01em;white-space:pre-line;max-width:15ch}
  .kicker{font-size:22px;font-weight:500;color:rgba(255,255,255,.62)}
  .rule{width:64px;height:3px;background:${card.accent ?? GOLD};margin-bottom:26px}
</style>
<div class="art"></div><div class="scrim"></div>
<div class="body">
  <div class="top"><img class="logo" src="${logoUri}" alt=""><span class="eyebrow">${card.eyebrow}</span></div>
  <div><div class="rule"></div><h1>${card.title}</h1></div>
  <div class="kicker">${card.kicker}</div>
</div>`;

const browser = await chromium.launch();
const logoUri = `data:image/png;base64,${(await readFile(path.join(publicDir, 'brand_logo.png'))).toString('base64')}`;

// With no arguments every card is rebuilt; name some outputs to rebuild only those (a re-render of the others would re-encode committed files for no change).
const only = process.argv.slice(2);
const selected = only.length === 0 ? CARDS : CARDS.filter((card) => only.includes(card.out));
if (only.length > 0 && selected.length !== only.length) throw new Error(`Unknown card(s): ${only.filter((name) => !CARDS.some((card) => card.out === name)).join(', ')}`);

for (const card of selected) {
  const tab = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await tab.setContent(page(card, await asDataUri(card.art), logoUri), { waitUntil: 'networkidle' });
  await tab.evaluate(() => document.fonts.ready);
  await writeFile(path.join(publicDir, card.out), await tab.screenshot({ type: 'png' }));
  await tab.close();
  console.log(`  wrote public/${card.out}`);
}

await browser.close();
