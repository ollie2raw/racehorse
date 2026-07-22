import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { getOrCreateGuestDisplayName, getOrCreateGuestIdentityId } from '../match/recovery/matchRecovery';

/**
 * useAuthSession
 *
 * Single source of truth for auth identity in the app shell.
 * Wraps useAuth() and exposes stable refs for use in callbacks
 * and effects that cannot take reactive dependencies on auth state.
 *
 * This hook exists because multiple async operations (socket join,
 * tournament attach, match recovery) need access to the current user
 * without re-subscribing when auth state updates.
 */
export function useAuthSession() {
  const {
    user: authUser,
    profile: authProfile,
    accessToken: authAccessToken,
    loading: authLoading,
    justVerified,
    supabaseEnabled,
    supabaseConfigError,
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    passwordRecoveryPending,
    clearPasswordRecoveryPending,
    signOut,
    updateUsername,
    refreshAuthProfile,
    applyProfilePatch,
  } = useAuth();
  const [guestIdentityId] = useState(getOrCreateGuestIdentityId);
  const [guestDisplayName] = useState(getOrCreateGuestDisplayName);
  const multiplayerIdentityUserId = authUser?.id ?? guestIdentityId;
  const multiplayerAuthToken = authUser?.id ? authAccessToken : null;

  const authUserRef = useRef(authUser);
  const authProfileRef = useRef(authProfile);
  const authAccessTokenRef = useRef<string | null>(authAccessToken);
  const multiplayerIdentityUserIdRef = useRef(multiplayerIdentityUserId);

  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  const isAdmin = Boolean(
    authUser?.email && adminEmail && authUser.email.toLowerCase() === adminEmail.toLowerCase(),
  );

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    authProfileRef.current = authProfile;
  }, [authProfile]);

  useEffect(() => {
    authAccessTokenRef.current = authAccessToken;
  }, [authAccessToken]);

  useEffect(() => {
    multiplayerIdentityUserIdRef.current = multiplayerIdentityUserId;
  }, [multiplayerIdentityUserId]);

  return {
    authUser,
    authProfile,
    authAccessToken,
    authLoading,
    justVerified,
    supabaseEnabled,
    supabaseConfigError,
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    passwordRecoveryPending,
    clearPasswordRecoveryPending,
    signOut,
    updateUsername,
    refreshAuthProfile,
    applyProfilePatch,
    guestIdentityId,
    guestDisplayName,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    authUserRef,
    authProfileRef,
    authAccessTokenRef,
    multiplayerIdentityUserIdRef,
    isAdmin,
  };
}
