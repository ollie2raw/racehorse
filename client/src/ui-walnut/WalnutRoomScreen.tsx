import { useState, type CSSProperties } from 'react';
import type { Tile } from '../types';
import HandTray from './components/HandTray';
import DominoTile from './components/DominoTile';
import { fadeIn, hoverLift, tileSettle, turnPulse } from './motion';
import { walnutFeltTexture, walnutNoiseBackground, walnutTheme, walnutThemeVars } from './theme';

const mockBoard: Tile[] = [
  { low: 1, high: 6 },
  { low: 2, high: 6 },
  { low: 2, high: 4 },
  { low: 4, high: 5 },
  { low: 3, high: 5 },
  { low: 3, high: 3 },
  { low: 0, high: 3 },
];

const mockHand: Tile[] = [
  { low: 0, high: 1 },
  { low: 0, high: 6 },
  { low: 2, high: 2 },
  { low: 1, high: 4 },
  { low: 3, high: 6 },
  { low: 5, high: 5 },
  { low: 4, high: 6 },
];

export default function WalnutRoomScreen() {
  const [selectedTile, setSelectedTile] = useState<Tile | null>(mockHand[2] ?? null);
  const [isYourTurn] = useState(true);

  const rootStyle = {
    ...walnutThemeVars,
    '--noise-texture': walnutNoiseBackground,
    '--felt-texture': walnutFeltTexture,
    '--fade-duration': `${fadeIn.transition.duration ?? 0.26}s`,
    '--hover-duration': `${hoverLift.transition.duration ?? 0.2}s`,
    '--turn-pulse-duration': `${turnPulse.transition.duration ?? 2.2}s`,
    '--tile-settle-duration': `${tileSettle.transition.type === 'spring' ? 0.52 : 0.45}s`,
    '--lift-y': `${hoverLift.animate.y}px`,
    fontFamily: walnutTheme.fontStack,
  } as CSSProperties;

  return (
    <main className="walnut-root" style={rootStyle}>
      <style>{styles}</style>

      <div className="walnut-atmo walnut-atmo-a" aria-hidden="true" />
      <div className="walnut-atmo walnut-atmo-b" aria-hidden="true" />

      <section className="walnut-top-rail" aria-label="Players and score">
        <article className={`walnut-player-card you ${isYourTurn ? 'is-active' : 'is-inactive'}`}>
          <span className="walnut-avatar" aria-hidden="true">
            YU
          </span>
          <div className="walnut-player-meta">
            <p className="walnut-player-label">YOU</p>
            <p className="walnut-player-name">Racer</p>
          </div>
          <p className="walnut-player-score">42</p>
          {isYourTurn && <span className="walnut-turn-chip">Your Turn</span>}
        </article>

        <span className="walnut-vs-chip">VS</span>

        <article className={`walnut-player-card opp ${!isYourTurn ? 'is-active' : 'is-inactive'}`}>
          <span className="walnut-avatar walnut-avatar-opp" aria-hidden="true">
            OP
          </span>
          <div className="walnut-player-meta">
            <p className="walnut-player-label">OPP</p>
            <p className="walnut-player-name">Rival</p>
          </div>
          <p className="walnut-player-score">35</p>
        </article>
      </section>

      <section className="walnut-stage-shell" aria-label="Board stage">
        <div className="walnut-stage-rim">
          <div className="walnut-stage-felt">
            <div className="walnut-chain" role="list" aria-label="Domino chain">
              {mockBoard.map((tile, idx) => (
                <DominoTile
                  key={`board-${tile.low}-${tile.high}-${idx}`}
                  tile={tile}
                  size={84}
                  className="walnut-board-tile"
                  style={{ animationDelay: `${idx * 0.06}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="walnut-dock-wrap">
        <HandTray
          tiles={mockHand}
          tileSize={76}
          selectedTile={selectedTile}
          onSelectTile={setSelectedTile}
          actions={[]}
        />
      </div>
    </main>
  );
}

const styles = `
.walnut-root {
  height: 99.5dvh;
  max-height: 99.5dvh;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr auto;
  align-items: start;
  gap: clamp(12px, 2.2vh, 24px);
  padding: clamp(10px, 2.4vw, 24px) clamp(12px, 2.8vw, 26px) clamp(14px, 2.8vw, 26px);
  color: var(--walnut-text);
  background:
    radial-gradient(70% 62% at 50% 44%, var(--walnut-spotlight) 0%, transparent 74%),
    linear-gradient(168deg, var(--walnut-bg-top) 0%, var(--walnut-bg-mid) 52%, var(--walnut-bg-bottom) 100%);
  position: relative;
  overflow: hidden;
}

.walnut-root::before,
.walnut-root::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.walnut-root::before {
  background-image: var(--noise-texture);
  background-size: 190px 190px, 250px 250px;
  opacity: 0.2;
  mix-blend-mode: soft-light;
}

.walnut-root::after {
  background: radial-gradient(circle at center, transparent 36%, var(--walnut-vignette) 100%);
}

.walnut-atmo {
  position: absolute;
  border-radius: 50%;
  filter: blur(2px);
  pointer-events: none;
  z-index: 0;
}

.walnut-atmo-a {
  width: 340px;
  height: 340px;
  top: -80px;
  right: -120px;
  background: radial-gradient(circle, rgba(178, 244, 224, 0.13) 0%, rgba(178, 244, 224, 0) 72%);
}

.walnut-atmo-b {
  width: 240px;
  height: 240px;
  left: -70px;
  bottom: 140px;
  background: radial-gradient(circle, rgba(198, 252, 236, 0.08) 0%, rgba(198, 252, 236, 0) 70%);
}

.walnut-top-rail,
.walnut-stage-shell,
.walnut-dock-wrap {
  position: relative;
  z-index: 2;
}

.walnut-top-rail {
  margin: 0 auto;
  width: min(95vw, 1120px);
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 1fr);
  align-items: center;
  gap: clamp(8px, 1.4vw, 16px);
  animation: walnutFadeIn var(--fade-duration) cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.walnut-player-card {
  border-radius: var(--walnut-radius-xl);
  border: 1px solid var(--walnut-card-border);
  box-shadow: var(--walnut-shadow-elev-2), inset 0 1px 0 var(--walnut-glass-inner);
  backdrop-filter: blur(var(--walnut-blur));
  -webkit-backdrop-filter: blur(var(--walnut-blur));
  padding: clamp(12px, 1.6vw, 18px);
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  transition: filter var(--hover-duration) ease, transform var(--hover-duration) ease;
  min-height: 102px;
}

.walnut-player-card.you {
  background: linear-gradient(150deg, var(--walnut-card-you-top) 0%, var(--walnut-card-you-bottom) 100%);
}

.walnut-player-card.opp {
  background: linear-gradient(150deg, var(--walnut-card-opp-top) 0%, var(--walnut-card-opp-bottom) 100%);
}

.walnut-player-card.is-active {
  box-shadow:
    0 0 0 1px rgba(160, 250, 216, 0.58),
    0 0 34px var(--walnut-accent-soft),
    var(--walnut-shadow-elev-2),
    inset 0 1px 0 rgba(255, 255, 255, 0.36);
  animation: walnutTurnPulse var(--turn-pulse-duration) ease-out infinite;
}

.walnut-player-card.is-inactive {
  filter: saturate(0.87) opacity(0.88);
}

.walnut-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #03231a;
  background: linear-gradient(145deg, #d5ffe9 0%, #81f2c3 100%);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.7), 0 6px 14px rgba(3, 16, 12, 0.3);
}

.walnut-avatar-opp {
  background: linear-gradient(145deg, #eef7f3 0%, #9dbbb0 100%);
  color: #1d322c;
}

.walnut-player-meta {
  min-width: 0;
}

.walnut-player-label {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.13em;
  color: var(--walnut-text-dim);
}

.walnut-player-name {
  margin: 5px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(241, 251, 247, 0.9);
}

.walnut-player-score {
  margin: 0;
  font-size: clamp(38px, 5vw, 56px);
  line-height: 0.9;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.walnut-turn-chip,
.walnut-vs-chip {
  border-radius: var(--walnut-radius-pill);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.walnut-turn-chip {
  grid-column: 1 / -1;
  justify-self: start;
  margin-top: 2px;
  padding: 6px 10px;
  background: rgba(130, 241, 201, 0.15);
  border: 1px solid rgba(146, 246, 212, 0.45);
  color: #d7fbea;
}

.walnut-vs-chip {
  justify-self: center;
  padding: 8px 12px;
  background: rgba(229, 249, 241, 0.14);
  border: 1px solid rgba(244, 255, 250, 0.28);
  color: var(--walnut-text-dim);
  box-shadow: var(--walnut-shadow-elev-1);
}

.walnut-stage-shell {
  width: ${walnutTheme.stageWidth};
  height: ${walnutTheme.stageHeight};
  margin: -6px auto 0;
  display: grid;
  place-items: center;
}

.walnut-stage-rim {
  width: 100%;
  height: 100%;
  border-radius: 49% / 42%;
  padding: clamp(16px, 2vw, 22px);
  background: linear-gradient(180deg, var(--walnut-rim-top) 0%, var(--walnut-rim-bottom) 100%);
  box-shadow: var(--walnut-shadow-elev-3), inset 0 2px 0 rgba(255, 232, 214, 0.24), inset 0 -10px 24px rgba(0, 0, 0, 0.38);
}

.walnut-stage-felt {
  width: 100%;
  height: 100%;
  border-radius: 47% / 40%;
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(68% 72% at 50% 36%, rgba(199, 255, 236, 0.16) 0%, transparent 76%),
    linear-gradient(180deg, var(--walnut-felt-top) 0%, var(--walnut-felt-bottom) 100%);
  box-shadow:
    inset 0 1px 0 var(--walnut-stage-ring),
    inset 0 -36px 60px var(--walnut-stage-vignette);
}

.walnut-stage-felt::before,
.walnut-stage-felt::after {
  content: "";
  position: absolute;
  pointer-events: none;
}

.walnut-stage-felt::before {
  inset: 0;
  background-image: var(--felt-texture);
  opacity: 0.28;
  mix-blend-mode: soft-light;
}

.walnut-stage-felt::after {
  left: 12%;
  right: 12%;
  top: 49%;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent 0%, var(--walnut-stage-lane) 28%, var(--walnut-stage-lane) 72%, transparent 100%);
  box-shadow: 0 0 16px rgba(131, 241, 202, 0.22);
}

.walnut-chain {
  width: 100%;
  padding: clamp(12px, 2vw, 20px) clamp(20px, 4vw, 50px);
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: clamp(10px, 1.3vw, 16px);
}

.walnut-board-tile {
  animation: walnutTileSettle var(--tile-settle-duration) cubic-bezier(0.22, 0.8, 0.2, 1) both;
}

.walnut-dock-wrap {
  width: min(96vw, 1120px);
  margin: 0 auto;
}

.walnut-hand-dock {
  border-radius: var(--walnut-radius-xxl);
  border: 1px solid var(--walnut-glass-stroke);
  background: linear-gradient(180deg, rgba(236, 255, 247, 0.23), rgba(225, 248, 239, 0.1));
  box-shadow:
    var(--walnut-shadow-elev-2),
    inset 0 1px 0 var(--walnut-glass-inner),
    inset 0 -14px 24px rgba(0, 9, 8, 0.22);
  padding: clamp(16px, 2.5vw, 24px);
  backdrop-filter: blur(var(--walnut-blur-strong));
  -webkit-backdrop-filter: blur(var(--walnut-blur-strong));
}

.walnut-hand-row {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  gap: clamp(10px, 1.5vw, 16px);
  overflow-x: auto;
  padding: 6px 4px;
}

.walnut-hand-row::-webkit-scrollbar {
  height: 8px;
}

.walnut-hand-row::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 999px;
}

.walnut-hand-item {
  flex: 0 0 auto;
  transition: transform var(--hover-duration) ease;
}

.walnut-hand-item:hover + .walnut-hand-item {
  transform: translateX(3px);
}

.walnut-hand-item:has(+ .walnut-hand-item:hover) {
  transform: translateX(-3px);
}

.walnut-hand-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.walnut-action-ghost {
  border: 1px solid rgba(244, 255, 251, 0.36);
  color: var(--walnut-text);
  background: rgba(240, 255, 249, 0.09);
  border-radius: var(--walnut-radius-pill);
  padding: 7px 14px;
  font-size: 12px;
}

.walnut-action-ghost:hover {
  background: rgba(240, 255, 249, 0.18);
}

.walnut-domino {
  position: relative;
  border: 1px solid rgba(213, 226, 221, 0.95);
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(167deg, #fcfcfb 0%, #f4f3ee 62%, #eceae2 100%);
  box-shadow:
    var(--walnut-shadow-tile),
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    inset 0 -1px 0 rgba(101, 108, 99, 0.26),
    inset 1px 0 0 rgba(255, 255, 255, 0.4);
  padding: 0;
  transition:
    transform var(--hover-duration) cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow var(--hover-duration) ease,
    filter var(--hover-duration) ease;
}

.walnut-domino.is-interactive {
  cursor: pointer;
}

.walnut-domino.is-interactive:hover {
  transform: translateY(var(--lift-y));
  box-shadow:
    0 16px 26px rgba(2, 12, 10, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    inset 0 -1px 0 rgba(101, 108, 99, 0.28);
}

.walnut-domino.is-selected {
  transform: translateY(-5px) scale(1.03);
  box-shadow:
    0 0 0 1px rgba(253, 255, 254, 0.88),
    0 0 24px rgba(127, 241, 201, 0.5),
    0 18px 28px rgba(2, 12, 10, 0.45);
}

.walnut-domino:focus-visible {
  outline: 2px solid #b5fce0;
  outline-offset: 2px;
}

.walnut-domino:disabled {
  cursor: default;
  opacity: 0.64;
}

.walnut-domino-gloss,
.walnut-domino-speck {
  pointer-events: none;
  position: absolute;
}

.walnut-domino-gloss {
  top: 0;
  left: 4%;
  width: 92%;
  height: 46%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(255, 255, 255, 0.04));
}

.walnut-domino-speck {
  inset: 0;
  opacity: 0.09;
  background-image: radial-gradient(circle at 20% 28%, rgba(24, 28, 22, 0.35) 0 0.4px, transparent 0.5px);
  background-size: 12px 12px;
}

.walnut-domino-inner {
  display: flex;
  align-items: stretch;
}

.walnut-domino-divider {
  width: 2px;
  margin: 7px 2px;
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(80, 88, 83, 0.16), rgba(27, 36, 33, 0.5));
}

.walnut-pip-half {
  position: relative;
  flex-shrink: 0;
}

.walnut-pip {
  position: absolute;
  border-radius: 50%;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42), 0 0 0 1px rgba(6, 14, 12, 0.22);
}

@keyframes walnutFadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes walnutTurnPulse {
  0% {
    box-shadow:
      0 0 0 0 rgba(131, 241, 202, 0.2),
      0 0 30px rgba(131, 241, 202, 0.35),
      var(--walnut-shadow-elev-2),
      inset 0 1px 0 rgba(255, 255, 255, 0.36);
  }
  100% {
    box-shadow:
      0 0 0 14px rgba(131, 241, 202, 0),
      0 0 16px rgba(131, 241, 202, 0.2),
      var(--walnut-shadow-elev-2),
      inset 0 1px 0 rgba(255, 255, 255, 0.36);
  }
}

@keyframes walnutTileSettle {
  from {
    opacity: 0;
    transform: translateY(-12px) scale(0.95) rotate(-1deg);
  }
  70% {
    transform: translateY(2px) scale(1.01) rotate(0.25deg);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1) rotate(0deg);
  }
}

@media (max-width: 980px) {
  .walnut-root {
    gap: 12px;
  }

  .walnut-top-rail {
    grid-template-columns: 1fr;
    width: min(96vw, 720px);
    gap: 8px;
  }

  .walnut-vs-chip {
    justify-self: center;
  }

  .walnut-player-card {
    min-height: 92px;
  }

  .walnut-stage-shell {
    height: min(46vh, 390px);
    margin-top: -2px;
  }
}

@media (max-width: 700px) {
  .walnut-root {
    padding: 10px;
  }

  .walnut-stage-shell {
    width: min(98vw, 640px);
    height: min(42vh, 340px);
  }

  .walnut-stage-rim {
    padding: 12px;
  }

  .walnut-player-card {
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    padding: 10px 12px;
  }

  .walnut-player-score {
    font-size: clamp(32px, 9vw, 44px);
  }

  .walnut-avatar {
    width: 46px;
    height: 46px;
  }

  .walnut-dock-wrap {
    width: min(98vw, 700px);
  }

  .walnut-hand-dock {
    border-radius: 24px;
    padding: 12px;
  }
}
`;
