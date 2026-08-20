import React from 'react';
import type { AppRoutesProps } from './appRouteTypes';
import { JOURNEY_MODE_VISIBLE, LEARN_MODE_VISIBLE } from './appRouteTypes';
import { resolveSpectatorGatedMode } from './config/spectatorModeFeature';
import {
  HomeRoute,
  NoBrainerRoute,
  LearnRoute,
  GuidedMatchAnnotatorRoute,
  GuidedMatchRecorderRoute,
  BotSetupRoute,
  BotMatchRoute,
  GhostSetupRoute,
  GhostMatchRoute,
  SinglePlayerHubRoute,
  JourneyRoute,
} from './routes/soloPlayRoutes';
import {
  DailyRoute,
  DailyPuzzleLeaderboardRoute,
  DailyFritzRoute,
  DailyFritzLeaderboardRoute,
} from './routes/dailyRoutes';
import {
  spectatorModeEnabled,
  LiveNowScreen,
  LiveNowRoute,
  RatingHistoryRoute,
  FriendsRoute,
  StatsRoute,
  FeedRoute,
  LeaderboardRoute,
  ProfileRoute,
} from './routes/socialRoutes';
import { TournamentRoute } from './routes/tournamentRoutes';
import { MultiplayerRoute } from './routes/multiplayerRoute';
import DailyFritzHealthAdminScreen from './admin/DailyFritzHealthAdminScreen';

export default function AppRoutes({
  shell,
  navigation,
  auth,
  learn,
  botMatch,
  ghost,
  social,
  multiplayer,
  tournament: tournamentProps,
}: AppRoutesProps) {
  const { fallbackConnectionHost } = shell;
  const { appMode, setAppMode } = navigation;
  React.useEffect(() => {
    const resolved = resolveSpectatorGatedMode(appMode, spectatorModeEnabled);
    if (resolved !== appMode) setAppMode(resolved);
  }, [appMode, setAppMode]);

  if (appMode === 'home' || (appMode === 'live' && !spectatorModeEnabled)) {
    return <HomeRoute shell={shell} navigation={navigation} auth={auth} tournament={tournamentProps} />;
  }

  if (appMode === 'noBrainer') {
    return <NoBrainerRoute shell={shell} navigation={navigation} auth={auth} />;
  }

  if (appMode === 'learn' && LEARN_MODE_VISIBLE) {
    return (
      <LearnRoute shell={shell} navigation={navigation} auth={auth} learn={learn} botMatch={botMatch} />
    );
  }

  if (appMode === 'guidedMatchAnnotator') {
    return <GuidedMatchAnnotatorRoute shell={shell} navigation={navigation} />;
  }

  if (appMode === 'guidedMatchRecorder') {
    return <GuidedMatchRecorderRoute shell={shell} navigation={navigation} />;
  }

  if (appMode === 'botSetup') {
    return <BotSetupRoute shell={shell} navigation={navigation} auth={auth} botMatch={botMatch} />;
  }

  if (appMode === 'bot') {
    return (
      <BotMatchRoute
        shell={shell}
        navigation={navigation}
        auth={auth}
        learn={learn}
        botMatch={botMatch}
      />
    );
  }

  if (appMode === 'ghostSetup') {
    return <GhostSetupRoute shell={shell} navigation={navigation} auth={auth} ghost={ghost} />;
  }

  if (appMode === 'ghost') {
    return (
      <GhostMatchRoute
        shell={shell}
        navigation={navigation}
        auth={auth}
        ghost={ghost}
        botMatch={botMatch}
      />
    );
  }

  if (appMode === 'daily') {
    return <DailyRoute shell={shell} navigation={navigation} auth={auth} />;
  }

  if (appMode === 'dailyPuzzleLeaderboard') {
    return <DailyPuzzleLeaderboardRoute shell={shell} navigation={navigation} auth={auth} />;
  }

  if (appMode === 'dailyFritz') {
    return (
      <DailyFritzRoute shell={shell} navigation={navigation} auth={auth} ghost={ghost} social={social} />
    );
  }

  if (appMode === 'dailyFritzLeaderboard') {
    return <DailyFritzLeaderboardRoute shell={shell} navigation={navigation} auth={auth} />;
  }

  if (appMode === 'live' && spectatorModeEnabled && LiveNowScreen) {
    return <LiveNowRoute shell={shell} navigation={navigation} social={social} />;
  }

  if (appMode === 'ratingHistory') {
    return <RatingHistoryRoute shell={shell} navigation={navigation} auth={auth} />;
  }

  if (appMode === 'friends') {
    return <FriendsRoute shell={shell} navigation={navigation} auth={auth} social={social} />;
  }

  if (appMode === 'stats') {
    return <StatsRoute shell={shell} navigation={navigation} auth={auth} />;
  }

  if (appMode === 'feed') {
    return <FeedRoute shell={shell} navigation={navigation} auth={auth} social={social} />;
  }

  if (appMode === 'leaderboard') {
    return <LeaderboardRoute shell={shell} navigation={navigation} auth={auth} social={social} />;
  }

  if (appMode === 'profile') {
    return <ProfileRoute shell={shell} navigation={navigation} auth={auth} social={social} />;
  }

  if (appMode === 'singlePlayerHub') {
    return <SinglePlayerHubRoute shell={shell} navigation={navigation} auth={auth} />;
  }

  if (appMode === 'journey' && JOURNEY_MODE_VISIBLE) {
    return (
      <JourneyRoute shell={shell} navigation={navigation} auth={auth} botMatch={botMatch} />
    );
  }

  if (appMode === 'tournament') {
    return (
      <TournamentRoute shell={shell} navigation={navigation} auth={auth} tournament={tournamentProps} />
    );
  }

  if (appMode === 'dailyFritzHealthAdmin') {
    return <DailyFritzHealthAdminScreen />;
  }

  if (appMode === 'multiplayer') {
    return <MultiplayerRoute shell={shell} social={social} multiplayer={multiplayer} />;
  }

  return fallbackConnectionHost;
}
