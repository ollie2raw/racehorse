import { useEffect, useRef, useState } from 'react';
import { BotMatchScreenView } from './BotMatchScreenView';
import type { BotMatchScreenProps } from './botMatchScreenTypes';
import { useBotMatchScreenController } from './useBotMatchScreenController';
import {
  isLessonV2Preloaded,
  preloadLessonV2ForBotMatch,
} from '../modules/match/bootstrap/lessonV2LazyRegistry.ts';
import { ScreenLoader } from '../ui/ScreenLoader.tsx';
import { BotMatchGuidedV2BootErrorView } from './view/states/BotMatchGuidedV2BootErrorView.tsx';

function botMatchNeedsLessonV2(props: BotMatchScreenProps): boolean {
  return (props.mode ?? 'bot') === 'bot' && Boolean(props.isGuidedV2Mode || props.isAuthoringV2Mode);
}

function BotMatchScreenInner(props: BotMatchScreenProps) {
  const viewProps = useBotMatchScreenController(props);
  return <BotMatchScreenView {...viewProps} />;
}

export default function BotMatchScreen(props: BotMatchScreenProps) {
  const needsLessonV2 = botMatchNeedsLessonV2(props);
  const wasNeedingLessonV2Ref = useRef(needsLessonV2);
  const [lessonV2Ready, setLessonV2Ready] = useState(
    !needsLessonV2 || isLessonV2Preloaded(),
  );
  const [lessonV2LoadError, setLessonV2LoadError] = useState<string | null>(null);
  const lessonV2Preloaded = isLessonV2Preloaded();
  const enteredLessonV2Mode = needsLessonV2 && !wasNeedingLessonV2Ref.current;
  const shouldBlockForLessonV2 =
    needsLessonV2 &&
    !lessonV2Preloaded &&
    !lessonV2LoadError &&
    (enteredLessonV2Mode || !lessonV2Ready);

  useEffect(() => {
    wasNeedingLessonV2Ref.current = needsLessonV2;
  }, [needsLessonV2]);

  useEffect(() => {
    if (!needsLessonV2) {
      setLessonV2Ready(true);
      setLessonV2LoadError(null);
      return;
    }
    if (lessonV2Preloaded) {
      setLessonV2Ready(true);
      setLessonV2LoadError(null);
      return;
    }
    let cancelled = false;
    setLessonV2Ready(false);
    setLessonV2LoadError(null);
    void preloadLessonV2ForBotMatch()
      .then(() => {
        if (!cancelled) setLessonV2Ready(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setLessonV2Ready(false);
        setLessonV2LoadError(error instanceof Error ? error.message : 'Unable to load lesson.');
      });
    return () => {
      cancelled = true;
    };
  }, [lessonV2Preloaded, needsLessonV2]);

  if (lessonV2LoadError && needsLessonV2) {
    return (
      <BotMatchGuidedV2BootErrorView
        guidedV2BootError={lessonV2LoadError}
        onBack={props.onBack}
      />
    );
  }

  if (shouldBlockForLessonV2) {
    return <ScreenLoader label="Loading lesson…" />;
  }

  return <BotMatchScreenInner {...props} />;
}
