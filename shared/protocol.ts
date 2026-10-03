/**
 * Socket.IO protocol — event names and payload types shared between client and server.
 */

import type { Role } from './session.js';

/** Paths relative to the /api router. */
export const ASSET_ROUTES = {
  list: '/campaigns/:id/assets',
  item: '/campaigns/:id/assets/:assetId',
} as const;

export function campaignAssetsPath(campaignId: string): string {
  return `/api${ASSET_ROUTES.list.replace(':id', encodeURIComponent(campaignId))}`;
}

export function campaignAssetPath(campaignId: string, assetId: string): string {
  return `${campaignAssetsPath(campaignId)}/${encodeURIComponent(assetId)}`;
}

export interface AssetMeta {
  id: string;
  mime: string;
  size: number;
}

export interface AssetUploadResponse {
  id: string;
  size: number;
  created: boolean;
}

export interface AssetListResponse {
  assets: AssetMeta[];
}

// ---------------------------------------------------------------------------
// Event names
// ---------------------------------------------------------------------------

export const EVENTS = {
  /** Client → Server: join a campaign room */
  JOIN_ROOM: 'room:join',
  /** Server → Client: confirm room joined */
  ROOM_JOINED: 'room:joined',
  /** Server → Room: campaign state was updated */
  STATE_UPDATED: 'state:updated',
  /** Server → Room: a player connected */
  PLAYER_JOINED: 'player:joined',
  /** Server → Room: a player disconnected */
  PLAYER_LEFT: 'player:left',
  /** Server → Room: current player count */
  PLAYER_COUNT: 'player:count',
  /** Server → GM: full player list */
  PLAYER_LIST: 'player:list',
  /** Player → Server: answer a combat decision addressed to this player. */
  COMBAT_DECISION: 'combat:decision',
  /** Server → GM/room: validated combat decision ready to be applied. */
  COMBAT_DECISION_ACCEPTED: 'combat:decision:accepted',
  /** Server → Player: decision was rejected. */
  COMBAT_DECISION_REJECTED: 'combat:decision:rejected',
} as const;

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface JoinRoomPayload {
  campaignId: string;
  role: Role;
  displayName: string;
}

export interface RoomJoinedPayload {
  campaignId: string;
  playerCount: number;
}

export interface StateUpdatedPayload {
  version: number;
  updatedAt: string;
}

export interface PlayerJoinedPayload {
  displayName: string;
  role: Role;
  playerCount: number;
}

export interface PlayerLeftPayload {
  displayName: string;
  playerCount: number;
}

export interface PlayerCountPayload {
  count: number;
}

export interface PlayerInfo {
  socketId: string;
  displayName: string;
  role: Role;
}

export interface PlayerListPayload {
  players: PlayerInfo[];
}


export interface ActiveDefenseDecisionPayload {
  actionId: string;
  characterId: string;
  defenderInstanceId: string;
  kind: 'active-defense';
  defense: {
    type: string;
    baseDefense: number;
    modifiers: Array<{ label: string; value: number }>;
    injectedModifiers: Array<{ label: string; value: number }>;
    effectiveDefense: number;
    rollTotal: number | null;
    margin: number | null;
    success: boolean | null;
  };
}

export interface CombatDecisionAcceptedPayload extends ActiveDefenseDecisionPayload {
  submittedBy: string;
}

export interface CombatDecisionRejectedPayload {
  actionId?: string;
  message: string;
}
