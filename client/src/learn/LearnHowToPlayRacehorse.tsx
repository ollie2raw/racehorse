import { useCallback, useEffect, useState } from 'react';
import type { AppMode } from '../types';
import { AcademyVisuals } from './academy/AcademyVisuals';
import { LearnActionButton } from './academy/LearnActionButton';
import { LearnCoachPanel } from './academy/LearnCoachPanel';
import { LearnShell } from './academy/LearnShell';
import {
  HOW_TO_PLAY_MODULES,
  HOW_TO_PLAY_MODULE_COUNT,
} from './howToPlay/howToPlayModules';

export interface LearnHowToPlayRacehorseProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onStartGuidedMatch?: () => void;
}

export default function LearnHowToPlayRacehorse({
  onBack,
  onNavigate,
  onStartGuidedMatch,
}: LearnHowToPlayRacehorseProps) {
  const [page, setPage] = useState(0);
  const module = HOW_TO_PLAY_MODULES[page];
  const isFirst = page === 0;
  const isLast = page === HOW_TO_PLAY_MODULE_COUNT - 1;

  const goNext = useCallback(() => {
    setPage((p) => Math.min(p + 1, HOW_TO_PLAY_MODULE_COUNT - 1));
  }, []);

  const goPrev = useCallback(() => {
    setPage((p) => Math.max(p - 1, 0));
  }, []);

  const goTo = useCallback((index: number) => {
    setPage(Math.max(0, Math.min(index, HOW_TO_PLAY_MODULE_COUNT - 1)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && !isLast) goNext();
      if (e.key === 'ArrowLeft') {
        if (isFirst) onBack();
        else goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, isFirst, isLast, onBack]);

  const finalFooter = module.isFinal ? (
    <>
      <LearnActionButton
        label="Play Guided Match"
        variant="primary"
        disabled={!onStartGuidedMatch}
        onClick={() => onStartGuidedMatch?.()}
      />
      <LearnActionButton label="Back to Learn" variant="secondary" onClick={onBack} />
    </>
  ) : undefined;

  return (
    <LearnShell
      page={page}
      modules={HOW_TO_PLAY_MODULES}
      onGoTo={goTo}
      onBack={onBack}
      onPrev={goPrev}
      onNext={goNext}
      onNavigate={onNavigate}
      isFirst={isFirst}
      coach={
        <LearnCoachPanel
          stepLabel={module.stepLabel}
          title={module.title}
          lede={module.lede}
          beats={module.beats}
          momentumNote={module.runNote}
          takeaway={module.takeaway}
          footer={finalFooter}
        />
      }
      stage={<AcademyVisuals visual={module.visual} />}
    />
  );
}
