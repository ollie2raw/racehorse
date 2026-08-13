import { useState, useEffect } from 'react';
import type { UserProfile } from './useAuth';
import { isTemporaryUsername } from './useAuth';
import { fetchGhostProfileSummary, type GhostProfileSummary } from '../ghost/api';

export type UseAppSessionUiParams = {
  authUser: { id: string; email: string } | null;
  authProfile: UserProfile | null;
  authLoading: boolean;
  justVerified: boolean;
  showToast: (msg: string, duration?: number) => void;
};

export type UseAppSessionUiResult = {
  // Ghost mode
  ghostProfile: GhostProfileSummary | null;
  ghostOpponentName: string;
  ghostOpponentUserId: string | null;
  setGhostOpponentName: React.Dispatch<React.SetStateAction<string>>;
  setGhostOpponentUserId: React.Dispatch<React.SetStateAction<string | null>>;

  // Derived auth UI
  needsUsernameOnboarding: boolean;
  onboardingDismissed: boolean;
  setOnboardingDismissed: React.Dispatch<React.SetStateAction<boolean>>;

  // Modal open state
  authModalOpen: boolean;
  setAuthModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  usernameModalOpen: boolean;
  setUsernameModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  signingOut: boolean;
  setSigningOut: React.Dispatch<React.SetStateAction<boolean>>;
  weeklyStatsOpen: boolean;
  setWeeklyStatsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  welcomeOpen: boolean;
  setWelcomeOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useAppSessionUi(params: UseAppSessionUiParams): UseAppSessionUiResult {
  const { authUser, authProfile, authLoading, justVerified, showToast } = params;

  const [ghostProfile, setGhostProfile] = useState<GhostProfileSummary | null>(null);
  const [ghostOpponentName, setGhostOpponentName] = useState<string>('Ghost');
  const [ghostOpponentUserId, setGhostOpponentUserId] = useState<string | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [weeklyStatsOpen, setWeeklyStatsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const raw = window.localStorage.getItem('username_onboarding_dismissed');
    if (!raw) return false;
    const dismissedAt = parseInt(raw, 10);
    const SNOOZE_MS = 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < SNOOZE_MS;
  });

  // Fetch ghost profile when auth user changes
  useEffect(() => {
    if (!authUser) {
      setGhostProfile(null);
      return;
    }
    let active = true;
    void fetchGhostProfileSummary(authUser.id)
      .then((summary) => {
        if (active) setGhostProfile(summary);
      })
      .catch(() => {
        if (active) setGhostProfile(null);
      });
    return () => {
      active = false;
    };
  }, [authUser]);

  // Open welcome modal on first visit
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasSeen = window.localStorage.getItem('hasSeenWelcome');
    if (!hasSeen) setWelcomeOpen(true);
  }, []);

  // Toast on email verification
  useEffect(() => {
    if (justVerified) {
      showToast('✓ Email verified! Welcome to Racehorse Dominoes.', 5000);
    }
  }, [justVerified, showToast]);

  const needsUsernameOnboarding = Boolean(
    authUser && !authLoading && authProfile !== null && isTemporaryUsername(authProfile.username),
  );

  return {
    ghostProfile,
    ghostOpponentName,
    ghostOpponentUserId,
    setGhostOpponentName,
    setGhostOpponentUserId,
    needsUsernameOnboarding,
    onboardingDismissed,
    setOnboardingDismissed,
    authModalOpen,
    setAuthModalOpen,
    usernameModalOpen,
    setUsernameModalOpen,
    signingOut,
    setSigningOut,
    weeklyStatsOpen,
    setWeeklyStatsOpen,
    welcomeOpen,
    setWelcomeOpen,
  };
}
