import { useState, useEffect, useRef } from 'react';
import type { AppMode } from '../appRouteTypes';
import type { BotDealSize } from './botEngine';
import type { FritzTier } from './fritzConfig';
import { resolveDefaultPvfFritzTier, writeStoredPvfFritzTier } from './pvfTierPreference';
import { mutePreference } from '../utils/mutePreference';

export type UseBotGamePreferencesParams = {
  appMode: AppMode;
};

export type UseBotGamePreferencesResult = {
  isMuted: boolean;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
  isMutedRef: React.MutableRefObject<boolean>;
  botDealSize: BotDealSize;
  setBotDealSize: React.Dispatch<React.SetStateAction<BotDealSize>>;
  botFritzTier: FritzTier;
  setBotFritzTier: React.Dispatch<React.SetStateAction<FritzTier>>;
  isGuidedMode: boolean;
  setIsGuidedMode: React.Dispatch<React.SetStateAction<boolean>>;
  isAuthoringMode: boolean;
  setIsAuthoringMode: React.Dispatch<React.SetStateAction<boolean>>;
  isAuthoringV2Mode: boolean;
  setIsAuthoringV2Mode: React.Dispatch<React.SetStateAction<boolean>>;
  isGuidedV2Mode: boolean;
  setIsGuidedV2Mode: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useBotGamePreferences(
  params: UseBotGamePreferencesParams,
): UseBotGamePreferencesResult {
  const { appMode } = params;

  const [isMuted, setIsMuted] = useState<boolean>(() => mutePreference.get());
  const [botDealSize, setBotDealSize] = useState<BotDealSize>(() => {
    if (typeof window === 'undefined') return 7;
    const stored = window.localStorage.getItem('racehorse_bot_deal_size');
    return stored === '14' ? 14 : 7;
  });
  const [botFritzTier, setBotFritzTier] = useState<FritzTier>(() =>
    resolveDefaultPvfFritzTier(),
  );
  const [isGuidedMode, setIsGuidedMode] = useState(false);
  const [isAuthoringMode, setIsAuthoringMode] = useState(false);
  const [isAuthoringV2Mode, setIsAuthoringV2Mode] = useState(false);
  const [isGuidedV2Mode, setIsGuidedV2Mode] = useState(false);

  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    window.localStorage.setItem('racehorse_bot_deal_size', String(botDealSize));
  }, [botDealSize]);

  useEffect(() => {
    writeStoredPvfFritzTier(botFritzTier);
  }, [botFritzTier]);

  useEffect(() => {
    mutePreference.set(isMuted);
  }, [isMuted]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Reset deal size to default when entering bot setup
  useEffect(() => {
    if (appMode !== 'botSetup') return;
    setBotDealSize(7);
  }, [appMode]);

  return {
    isMuted,
    setIsMuted,
    isMutedRef,
    botDealSize,
    setBotDealSize,
    botFritzTier,
    setBotFritzTier,
    isGuidedMode,
    setIsGuidedMode,
    isAuthoringMode,
    setIsAuthoringMode,
    isAuthoringV2Mode,
    setIsAuthoringV2Mode,
    isGuidedV2Mode,
    setIsGuidedV2Mode,
  };
}
