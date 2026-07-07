import { useEffect, useState } from 'react';
import { BotMatchScreenView } from './BotMatchScreenView';
import type { BotMatchScreenProps } from './botMatchScreenTypes';
import { useBotMatchScreenController } from './useBotMatchScreenController';
import { preloadLessonV2ForBotMatch } from '../modules/match/bootstrap/lessonV2LazyRegistry.ts';
import { ScreenLoader } from '../ui/ScreenLoader.tsx';

function botMatchNeedsLessonV2(props: BotMatchScreenProps): boolean {
  return props.mode === 'bot' && Boolean(props.isGuidedV2Mode || props.isAuthoringV2Mode);
}

function BotMatchScreenInner(props: BotMatchScreenProps) {
  const viewProps = useBotMatchScreenController(props);
  return <BotMatchScreenView {...viewProps} />;
}

export default function BotMatchScreen(props: BotMatchScreenProps) {
  const needsLessonV2 = botMatchNeedsLessonV2(props);
  const [lessonV2Ready, setLessonV2Ready] = useState(!needsLessonV2);

  useEffect(() => {
    if (!needsLessonV2) {
      setLessonV2Ready(true);
      return;
    }
    let cancelled = false;
    void preloadLessonV2ForBotMatch().then(() => {
      if (!cancelled) setLessonV2Ready(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needsLessonV2]);

  if (!lessonV2Ready) {
    return <ScreenLoader label="Loading lesson…" />;
  }

  return <BotMatchScreenInner {...props} />;
}