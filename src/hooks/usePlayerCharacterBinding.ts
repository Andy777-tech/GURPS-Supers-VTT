import { useCallback, useEffect, useState } from 'react';
import { useSyncContextOptional } from '../net/SyncProvider';

/**
 * Device-local player → character binding.
 *
 * The campaign stores characters, while this preference identifies which one
 * this browser/device controls. Keeping it out of CampaignState prevents one
 * player's selection from overwriting another player's binding.
 */
export function usePlayerCharacterBinding() {
  const sync = useSyncContextOptional();
  const campaignId = sync?.sessionInfo?.campaignId ?? null;
  const displayName = sync?.displayName ?? null;
  const key = campaignId && displayName
    ? `gurps-vtt:player-character:${campaignId}:${displayName}`
    : null;

  const [characterId, setCharacterIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setCharacterIdState(null);
      return;
    }
    setCharacterIdState(window.localStorage.getItem(key));
  }, [key]);

  const setCharacterId = useCallback((next: string | null) => {
    setCharacterIdState(next);
    if (!key) return;
    if (next) window.localStorage.setItem(key, next);
    else window.localStorage.removeItem(key);
  }, [key]);

  return {
    characterId,
    setCharacterId,
    isOnlinePlayer: sync?.status === 'connected' && sync?.role === 'player',
  };
}
