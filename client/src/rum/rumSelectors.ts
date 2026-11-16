/**
 * How the collector recognises the screens it times, by what the screens already render (no hook in the screens themselves). If one of
 * these classes is renamed the metric stops reporting rather than reporting wrong values; rumSelectors.contract.test.ts fails first.
 */
export const SELECTORS = {
  hub: '.sp-solo-main',
  setup: '.pvf-root--setup',
  matchPvf: '.bot-match-screen[class*="bot-match-mode-"]:not(.bot-match-mode-daily-fritz):not(.learn-lesson-screen)',
  matchDaily: '.bot-match-screen.bot-match-mode-daily-fritz',
  matchMp: '.bot-match-screen:not([class*="bot-match-mode-"]):not(.learn-lesson-screen)',
  room: '.pml-roomcode-bar-code',
  handOver: '[data-testid="hand-over-modal"]',
  playableTile: '.hand-area:not(.pre-game-draw-hand-dock) .domino-tile.highlight:not(.disabled):not(.board-tile)',
} as const;

/** Where each selector's class is rendered, for the contract test. */
export const SELECTOR_SOURCES: Record<string, { file: string; needles: string[] }> = {
  hub: { file: 'screens/SinglePlayerHubScreen.tsx', needles: ['sp-solo-main'] },
  setup: { file: 'bot/PlayVsFritz.tsx', needles: ['pvf-root--setup'] },
  matchPvf: { file: 'bot/view/shell/BotMatchScreenShell.tsx', needles: ['bot-match-screen', 'bot-match-mode-'] },
  matchDaily: { file: 'bot/view/shell/BotMatchScreenShell.tsx', needles: ['bot-match-mode-'] },
  matchMp: { file: 'match/LiveMatchScreen.tsx', needles: ['bot-match-screen'] },
  room: { file: 'multiplayer/PrivateMatchLobbyControlPanel.tsx', needles: ['pml-roomcode-bar-code'] },
  handOver: { file: 'components/handOver/HandOverModal.tsx', needles: ['data-testid="hand-over-modal"'] },
  playableTile: { file: 'components/DominoTile.tsx', needles: ["'highlight'"] },
};
