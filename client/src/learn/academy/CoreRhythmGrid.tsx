import { HOW_TO_PLAY_MATCH_TARGET } from '../howToPlay/howToPlayModules';
import { LearnIcon, type LearnIconType } from './LearnIcons';

export const CORE_RHYTHM_TILES = [
  {
    key: 'must',
    name: 'Must play',
    desc: 'Legal tile? You play it.',
    accent: 'mint',
    icon: 'must-play',
  },
  {
    key: 'keep',
    name: 'Keep turn',
    desc: 'Score or double → again.',
    accent: 'gold',
    icon: 'keep-turn',
  },
  {
    key: 'draw',
    name: 'Auto draw',
    desc: 'Blocked? Game draws.',
    accent: 'mint',
    icon: 'auto-draw',
  },
  {
    key: 'race',
    name: `Race to ${HOW_TO_PLAY_MATCH_TARGET}`,
    desc: 'First to target wins.',
    accent: 'gold',
    icon: 'race-to-60',
  },
] as const satisfies ReadonlyArray<{
  key: string;
  name: string;
  desc: string;
  accent: 'mint' | 'gold';
  icon: LearnIconType;
}>;

type CoreRhythmGridProps = {
  sectionLabel: string;
};

/** Shared 2×2 rhythm cards (intro + ready recap). */
export function CoreRhythmGrid({ sectionLabel }: CoreRhythmGridProps) {
  return (
    <div className="learn-academy__rhythm-wrap">
      <p className="learn-academy__section-label">{sectionLabel}</p>
      <div className="learn-academy__rhythm-grid">
        {CORE_RHYTHM_TILES.map(({ key, name, desc, accent, icon }) => (
          <article key={key} className={`learn-academy__rhythm-card learn-academy__rhythm-card--${accent}`}>
            <div className={`learn-academy__rhythm-icon learn-academy__rhythm-icon--${accent}`}>
              <LearnIcon type={icon} />
            </div>
            <h3 className="learn-academy__rhythm-title">{name}</h3>
            <p className="learn-academy__rhythm-desc">{desc}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
