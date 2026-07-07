import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

export type UsePrivateMatchLobbyUiStateResult = {
  lobbyTab: 'create' | 'join';
  setLobbyTab: (tab: 'create' | 'join') => void;
  dealFormat: 7 | 14;
  setDealFormat: (format: 7 | 14) => void;
  privacy: 'invite' | 'code';
  setPrivacy: (privacy: 'invite' | 'code') => void;
  timedTurnsUi: 'untimed' | '30s';
  setTimedTurnsUi: Dispatch<SetStateAction<'untimed' | '30s'>>;
  copiedInvite: boolean;
  showFriendPicker: boolean;
  setShowFriendPicker: Dispatch<SetStateAction<boolean>>;
  creatingUserId: string | null;
  setCreatingUserId: Dispatch<SetStateAction<string | null>>;
  handleCopyInviteLink: (onCopyInviteLink: () => void) => void;
};

export function usePrivateMatchLobbyUiState(): UsePrivateMatchLobbyUiStateResult {
  const [lobbyTab, setLobbyTab] = useState<'create' | 'join'>('create');
  const [dealFormat, setDealFormat] = useState<7 | 14>(7);
  const [privacy, setPrivacy] = useState<'invite' | 'code'>('code');
  const [timedTurnsUi, setTimedTurnsUi] = useState<'untimed' | '30s'>('untimed');
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [creatingUserId, setCreatingUserId] = useState<string | null>(null);

  const handleCopyInviteLink = useCallback((onCopyInviteLink: () => void) => {
    onCopyInviteLink();
    setCopiedInvite(true);
    setTimeout(() => {
      setCopiedInvite(false);
    }, 2000);
  }, []);

  return {
    lobbyTab,
    setLobbyTab,
    dealFormat,
    setDealFormat,
    privacy,
    setPrivacy,
    timedTurnsUi,
    setTimedTurnsUi,
    copiedInvite,
    showFriendPicker,
    setShowFriendPicker,
    creatingUserId,
    setCreatingUserId,
    handleCopyInviteLink,
  };
}