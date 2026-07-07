import { Suspense, lazy } from 'react';
import type { GhostProfileSummary } from '../ghost/api';
import type { UserProfile } from '../auth/useAuth';
import type { DailyFritzStartResponse } from './api';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';
import type { DailyFritzGameCompletionPayload } from './dailyFritzScreenTypes';
import { DailyFritzLoadingScreen } from './DailyFritzLoadingScreen';

const LazyBotMatchScreen = lazy(() => import('../bot/BotMatchScreen'));

export type DailyFritzEmbeddedMatchViewProps = {
  embeddedMatchKey: string;
  activeRun: DailyFritzStartResponse;
  dailyFritzPackageForMatch: DailyFritzStartResponse | null;
  setOverlayConfig: DailyFritzSetOverlayViewModel | null;
  userId: string | null;
  username: string | null;
  profile: UserProfile | null;
  ghostProfile: GhostProfileSummary | null;
  onGhostProfileChange: (profile: GhostProfileSummary | null) => void;
  onProfileRefresh?: () => Promise<void> | void;
  onProfilePatch?: (patch: Partial<UserProfile>) => void;
  onBack: () => void;
  onEmbeddedBack: () => void;
  onDailyFritzGameComplete: (result: DailyFritzGameCompletionPayload) => void;
  onDailyFritzComplete: () => void;
};

export function DailyFritzEmbeddedMatchView({
  embeddedMatchKey,
  activeRun,
  dailyFritzPackageForMatch,
  setOverlayConfig,
  userId,
  username,
  profile,
  ghostProfile,
  onGhostProfileChange,
  onProfileRefresh,
  onProfilePatch,
  onBack,
  onEmbeddedBack,
  onDailyFritzGameComplete,
  onDailyFritzComplete,
}: DailyFritzEmbeddedMatchViewProps) {
  return (
    <Suspense
      fallback={
        <DailyFritzLoadingScreen
          phase="preparing"
          loadError={null}
          onBack={onBack}
          onRetry={() => {}}
          retryPending={false}
        />
      }
    >
      <LazyBotMatchScreen
        key={embeddedMatchKey}
        matchInstanceKey={embeddedMatchKey}
        onBack={onEmbeddedBack}
        mode="daily-fritz"
        userId={userId}
        username={username}
        dealSize={activeRun.deal_size}
        fritzTier={activeRun.fritz_tier}
        winningScore={activeRun.winning_score}
        currentGlickoRating={profile?.glicko_rating ?? null}
        ghostProfile={ghostProfile}
        onGhostProfileChange={onGhostProfileChange}
        onProfileRefresh={onProfileRefresh}
        onProfilePatch={onProfilePatch}
        dailyFritzPackage={dailyFritzPackageForMatch}
        dailyFritzSetOverlay={setOverlayConfig}
        onDailyFritzGameComplete={(result) => {
          onDailyFritzGameComplete(result);
        }}
        onDailyFritzComplete={() => {
          onDailyFritzComplete();
        }}
      />
    </Suspense>
  );
}