/** Player-visible frame of the real BotMatchScreen, read from the DOM on every React commit. */
export type ScreenFrame = {
  rack: number;
  boneyard: number;
  label: string;
  fritzSideActive: boolean;
  humanTilesEnabled: number;
  humanTiles: number;
  handOverModal: boolean;
  handOverTitle: string;
  scores: string;
  gameOverModal: boolean;
  html: string;
};

export function captureScreenFrame(root: ParentNode = document): ScreenFrame {
  const tiles = Array.from(root.querySelectorAll('.hand-container .guided-tile-wrap > *'));
  const gameOver = root.querySelector('.game-over-overlay:not(.hand-over-modal-overlay)');
  return {
    rack: root.querySelectorAll('.rh-tile-rack__tile').length,
    boneyard: Number(root.querySelector('.boneyard-count')?.textContent ?? NaN),
    label: root.querySelector('.wl-turn-label')?.textContent ?? '',
    fritzSideActive: Boolean(root.querySelector('.wl-center-status.is-fritz-turn')),
    humanTilesEnabled: tiles.filter((el) => !el.hasAttribute('aria-disabled')).length,
    humanTiles: tiles.length,
    handOverModal: Boolean(root.querySelector('[data-testid="hand-over-modal"]')),
    handOverTitle: root.querySelector('.hand-over-modal__title')?.textContent ?? '',
    scores: Array.from(root.querySelectorAll('.wl-player-score')).map((el) => el.textContent ?? '').join('/'),
    gameOverModal: Boolean(gameOver),
    html: (root as Element).innerHTML ?? document.body.innerHTML,
  };
}

export const frameKey = (f: ScreenFrame) =>
  [
    `rack=${f.rack}`,
    `by=${f.boneyard}`,
    `"${f.label}"`,
    f.fritzSideActive ? 'FRITZ' : 'you',
    `enabled=${f.humanTilesEnabled}/${f.humanTiles}`,
    `score=${f.scores}`,
    f.handOverModal ? `HANDOVER(${f.handOverTitle})` : '',
    f.gameOverModal ? 'GAMEOVER' : '',
  ].join(' ');
