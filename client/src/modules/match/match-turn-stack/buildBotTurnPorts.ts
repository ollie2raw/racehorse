import type { BotTurnPorts } from '../../bot-turn/types.ts';

export type BuildBotTurnPortsInput = {
  applyAndNotify: BotTurnPorts['applyAndNotify'];
  appendMove: BotTurnPorts['appendMove'];
  appendGhostMove: BotTurnPorts['appendGhostMove'];
  captureGuidedMatchCandidateAction: BotTurnPorts['captureGuidedMatchCandidateAction'];
  flashLastPlayed: BotTurnPorts['flashLastPlayed'];
  setSelectedTile: BotTurnPorts['setSelectedTile'];
  setDrawSequenceActiveBoth: BotTurnPorts['setDrawSequenceActiveBoth'];
  setLastBotChoice: BotTurnPorts['setLastBotChoice'];
  setGhostPlayedTile: BotTurnPorts['setGhostPlayedTile'];
  isAuthoringMode: boolean;
  handleAuthoringFritzActionCaptured: BotTurnPorts['onAuthoringFritzActionCaptured'];
  isAuthoringV2Mode: boolean;
  handleAuthoringV2FritzEvent: BotTurnPorts['onAuthoringV2FritzEvent'];
  isDailyFritzMode: boolean;
  handleDailyFritzBotMoveApplied: BotTurnPorts['onDailyFritzBotMoveApplied'];
};

export function buildBotTurnPorts(input: BuildBotTurnPortsInput): BotTurnPorts {
  return {
    applyAndNotify: input.applyAndNotify,
    appendMove: input.appendMove,
    appendGhostMove: input.appendGhostMove,
    captureGuidedMatchCandidateAction: input.captureGuidedMatchCandidateAction,
    flashLastPlayed: input.flashLastPlayed,
    setSelectedTile: input.setSelectedTile,
    setDrawSequenceActiveBoth: input.setDrawSequenceActiveBoth,
    setLastBotChoice: input.setLastBotChoice,
    setGhostPlayedTile: input.setGhostPlayedTile,
    onAuthoringFritzActionCaptured: input.isAuthoringMode
      ? input.handleAuthoringFritzActionCaptured
      : undefined,
    onAuthoringV2FritzEvent: input.isAuthoringV2Mode
      ? input.handleAuthoringV2FritzEvent
      : undefined,
    onDailyFritzBotMoveApplied: input.isDailyFritzMode
      ? input.handleDailyFritzBotMoveApplied
      : undefined,
  };
}