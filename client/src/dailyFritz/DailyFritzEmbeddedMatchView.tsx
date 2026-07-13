import { Suspense, lazy, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { BotMatchState } from '../modules/match/runtime/botEngine.ts';
import { DailyFritzBroadcastControl, useDailyFritzBroadcast } from './DailyFritzBroadcastControl.tsx';
import type { GhostProfileSummary } from '../ghost/api';
import type { UserProfile } from '../auth/useAuth';
import type { DailyFritzStartResponse } from './api';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';
import type { DailyFritzGameCompletionPayload } from './dailyFritzScreenTypes';
import { DailyFritzLoadingScreen } from './DailyFritzLoadingScreen';
import { isSpectatorModeEnabled } from '../config/spectatorModeFeature.ts';

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
  socket: Socket | null;
};

export function DailyFritzEmbeddedMatchView({
  ...props
}: DailyFritzEmbeddedMatchViewProps) {
  return isSpectatorModeEnabled()
    ? <DailyFritzSpectatorEnabledMatchView {...props} />
    : <DailyFritzCoreMatchView {...props} />;
}

function DailyFritzSpectatorEnabledMatchView({
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
  socket,
}: DailyFritzEmbeddedMatchViewProps) {
  const [publicState,setPublicState]=useState<BotMatchState|null>(null);
  const broadcast=useDailyFritzBroadcast({socket,runId:activeRun.attempt_id,userId,username,state:publicState});
  return (
    <>
    <DailyFritzBroadcastControl phase={broadcast.phase} count={broadcast.count} canStart={broadcast.canStart} onStart={broadcast.start} onStop={broadcast.stop}/>
    <DailyFritzCoreMatchView
      embeddedMatchKey={embeddedMatchKey}
      activeRun={activeRun}
      dailyFritzPackageForMatch={dailyFritzPackageForMatch}
      setOverlayConfig={setOverlayConfig}
      userId={userId}
      username={username}
      profile={profile}
      ghostProfile={ghostProfile}
      onGhostProfileChange={onGhostProfileChange}
      onProfileRefresh={onProfileRefresh}
      onProfilePatch={onProfilePatch}
      onBack={onBack}
      onEmbeddedBack={onEmbeddedBack}
      onDailyFritzGameComplete={onDailyFritzGameComplete}
      onDailyFritzComplete={onDailyFritzComplete}
      socket={socket}
      onPublicStateChange={setPublicState}
    />
    </>
  );
}

function DailyFritzCoreMatchView({
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
  onPublicStateChange,
}: DailyFritzEmbeddedMatchViewProps & { onPublicStateChange?: (state: BotMatchState) => void }) {
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
        onPublicStateChange={onPublicStateChange}
      />
    </Suspense>
  );
}
