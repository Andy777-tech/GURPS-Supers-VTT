import { useCombatHistory } from '../../hooks/useCombatHistory';
import { participantPosition, tokenAtCell, tokenFitsMap, resolveParticipantToken } from '../../utils/mapTokenSpatial';
import { buildTacticalTokens } from '../../utils/mapTokens';
/**
 * CombatMapPanel — renders the shared three-dimensional map surface for combat.
 *
 * Bridges combat data (participants with positions) to the map surface.
 */

import type { EdgePick, TilePointerEvent } from '../map/three/MapScene';
import { doorClickOverride, nextOverride } from '../../utils/mapEdges';
import { selectEdgeBlocker, selectResolvedEdges } from '../../state/selectors/mapEdges';

import { useCallback, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { MapModel, TileId } from '../../types/map';
import type { Participant, CombatState } from '../../types/combatTracker';
import { Map3DView } from '../map/views/Map3DView';
import type { MapToken } from '../map/three/MapScene';
import { useEffectiveRole } from '../../hooks/useEffectiveRole';
import { useCampaignStore } from '../../state/campaignStore';
import { computeVisibleTiles } from '../../utils/lineOfSight';

/** Returns Tailwind class string for category colours (used in legend). */
function categoryColorClass(cat: string): string {
  switch (cat) {
    case 'pc':
      return 'bg-accent-500 border-accent-300';
    case 'ally':
      return 'bg-success-500 border-success-300';
    case 'enemy':
      return 'bg-danger-500 border-danger-300';
    case 'neutral':
      return 'bg-yellow-500 border-yellow-300';
    default:
      return 'bg-surface-4 border-edge-bright';
  }
}

/** The participant whose token occupies the given grid cell, if any. */
export function findOccupantAt(
  participants: Participant[],
  row: number,
  col: number,
  map?: MapModel | null,
  selectedId?: string | null,
): Participant | undefined {
  const token = map && tokenAtCell(map, row, col, participants.find(p => p.instanceId === selectedId)?.tokenRef?.tokenId);
  return token ? participants.find(p => p.tokenRef?.mapId === map?.id && p.tokenRef.tokenId === token.id) : undefined;
}

/**
 * Whether a token may be picked up by drag.
 * GM: any token. Player: only the current actor, with movement available.
 */
export function canDragToken(
  occupant: Participant | undefined,
  opts: {
    isGmMode: boolean;
    currentActorInstanceId: string;
    movementBudgetYards: number;
    hasMovedThisTurn: boolean;
  },
): boolean {
  if (!occupant) return false;
  if (opts.isGmMode) return true;
  return (
    occupant.instanceId === opts.currentActorInstanceId &&
    !opts.hasMovedThisTurn &&
    opts.movementBudgetYards > 0
  );
}

export function CombatMapPanel({
  combat: _combat,
  participants,
  currentActorInstanceId,
  selectedParticipantId,
  onSelectParticipant,
  movementBudgetYards,
  hasMovedThisTurn,
  isGmMode: requestedGmMode,
  onMoveTo,
  onGmPlaceToken,
  losTileIds,
  onOpenConditions,
}: {
  combat: CombatState;
  participants: Participant[];
  currentActorInstanceId: string;
  selectedParticipantId: string | null;
  onSelectParticipant: (id: string | null) => void;
  movementBudgetYards: number;
  hasMovedThisTurn: boolean;
  isGmMode: boolean;
  onMoveTo: (tileId: string, path: string[], costYards: number) => void;
  onGmPlaceToken: (instanceId: string, tileId: string, row: number, col: number) => void;
  losTileIds: string[] | undefined;
  /** GM-only (Phase 12a.6): opens the condition popover for a participant at a screen point. */
  onOpenConditions?: (instanceId: string, anchor: { x: number; y: number }) => void;
}) {
  const { history, handleUndo, handleRedo } = useCombatHistory();
  const { isPlayer, isGM, displayName } = useEffectiveRole();
  const isGmMode = requestedGmMode && isGM;
  const { state, actions } = useCampaignStore();
  const linkedMap = _combat.mapId ? state.maps.mapsById[_combat.mapId] ?? null : null;
  const multiplayer = (state as typeof state & { multiplayer?: { playerCharacters: Record<string, string[]> } }).multiplayer;

  const resolvedEdges = linkedMap ? selectResolvedEdges(linkedMap) : null;
  const handleEdgeClick = useCallback((edge: EdgePick, event: TilePointerEvent): boolean => {
    if (!linkedMap) return false;
    const current = resolvedEdges?.get(edge.key);
    const override = doorClickOverride(current, isGmMode, event.shiftKey);
    if (override) actions.mapSetEdgeOverride(linkedMap.id, edge.key, override);
    return current?.kind === 'door';
  }, [linkedMap, resolvedEdges, isGmMode, actions]);
  const handleEdgeDoubleClick = useCallback((edge: EdgePick) => {
    if (!isGmMode || !linkedMap) return;
    actions.mapSetEdgeOverride(linkedMap.id, edge.key, nextOverride(resolvedEdges?.get(edge.key)));
  }, [linkedMap, resolvedEdges, isGmMode, actions]);

  // Per-player fog-of-war: compute visible tiles from player's character positions.
  // With no multiplayer assignment (offline hotseat), the whole party provides
  // vision — otherwise the player view is a black void with nothing pickable.
  const visibleTileIds = useMemo(() => {
    // Keyed off the VIEW, not the multiplayer role: offline hotseat has no
    // Player role (effective role is GM), but player view still needs vision.
    if (!linkedMap || isGmMode) return undefined;
    const assignedCharIds = displayName
      ? multiplayer?.playerCharacters[displayName] ?? []
      : [];
    const isVisionSource = (p: Participant): boolean =>
      assignedCharIds.length > 0
        ? !!p.id && assignedCharIds.includes(p.id)
        : p.category === 'player' || p.category === 'ally';
    const positions: TileId[] = [];
    for (const p of participants) {
      const position = participantPosition(linkedMap, p);
      if (position && isVisionSource(p)) {
        const row = position.row;
        const col = position.col;
        if (linkedMap.grid[row]?.[col]) {
          positions.push(linkedMap.grid[row][col]);
        }
      }
    }
    if (positions.length === 0) return undefined;
    return computeVisibleTiles(linkedMap, positions, selectEdgeBlocker(linkedMap));
  }, [linkedMap, isPlayer, isGmMode, displayName, multiplayer?.playerCharacters, participants]);

  // 3D tokens for placed participants (participants prop is already view-filtered)
  const tokens = useMemo<MapToken[] | undefined>(() => {
    if (!linkedMap) return undefined;
    return buildTacticalTokens(state, linkedMap.id, isGmMode).map(token => {
      const p = participants.find(p => p.tokenRef?.mapId === linkedMap.id && p.tokenRef.tokenId === token.id);
      return { ...token, isCurrent: p?.instanceId === currentActorInstanceId, isSelected: p?.instanceId === selectedParticipantId };
    });
  }, [state, linkedMap, isGmMode, participants, currentActorInstanceId, selectedParticipantId]);

  const visibleParticipants = participants.filter(p => !p.tokenRef || tokens?.some(t => t.id === p.tokenRef?.tokenId));

  // Handle tile click: move current actor or select participant on that tile
  const handleTileClick = useCallback(
    (tileId: TileId, row: number, col: number) => {
      // Check if a participant is on this tile
      const occupant = findOccupantAt(visibleParticipants, row, col, linkedMap, selectedParticipantId);
      if (occupant) {
        onSelectParticipant(
          occupant.instanceId === selectedParticipantId ? null : occupant.instanceId,
        );
        return;
      }

      // If GM mode, place selected participant (if any) on this tile
      if (isGmMode && selectedParticipantId) {
        onGmPlaceToken(selectedParticipantId, tileId, row, col);
        onSelectParticipant(null);
        return;
      }

      // Move current actor (basic: cost = 1 yard per tile, path = [tileId])
      if (!hasMovedThisTurn && movementBudgetYards > 0) {
        onMoveTo(tileId, [tileId], 1);
      }
    },
    [
      linkedMap,
      state.maps,
      visibleParticipants,
      selectedParticipantId,
      onSelectParticipant,
      isGmMode,
      onGmPlaceToken,
      hasMovedThisTurn,
      movementBudgetYards,
      onMoveTo,
    ],
  );

  // Drag-to-move: pointer-down on a draggable token starts a drag (empty terrain still orbits).
  const handleTokenDragStart = useCallback(
    (_tileId: TileId, row: number, col: number) => {
      const occupant = findOccupantAt(visibleParticipants, row, col, linkedMap, selectedParticipantId);
      const draggable = canDragToken(occupant, {
        isGmMode,
        currentActorInstanceId,
        movementBudgetYards,
        hasMovedThisTurn,
      });
      if (draggable) onSelectParticipant(occupant!.instanceId);
      return draggable;
    },
    [
      linkedMap,
      state.maps,
      visibleParticipants,
      isGmMode,
      currentActorInstanceId,
      movementBudgetYards,
      hasMovedThisTurn,
      onSelectParticipant,
    ],
  );

  const handleTokenDrop = useCallback(
    (from: { tileId: TileId; row: number; col: number }, to: { tileId: TileId; row: number; col: number }) => {
      const occupant = findOccupantAt(visibleParticipants, from.row, from.col, linkedMap, selectedParticipantId);
      if (!occupant || !linkedMap) return;
      const token = resolveParticipantToken(state.maps, occupant);
      if (!token) return;
      const position = { col: token.position.col + to.col - from.col, row: token.position.row + to.row - from.row };
      if (!tokenFitsMap(linkedMap, { ...token, position })) return;
      const targetTile = linkedMap.grid[position.row]?.[position.col];
      if (!targetTile) return;
      if (isGmMode) {
        onGmPlaceToken(occupant.instanceId, targetTile, position.row, position.col);
      } else if (occupant.instanceId === currentActorInstanceId) {
        // Same cost model as click-to-move.
        onMoveTo(targetTile, [targetTile], 1);
      }
      onSelectParticipant(null);
    },
    [
      linkedMap,
      state.maps,
      visibleParticipants,
      isGmMode,
      currentActorInstanceId,
      onGmPlaceToken,
      onMoveTo,
      onSelectParticipant,
    ],
  );

  if (!linkedMap) {
    return (
      <div className="h-full w-full flex items-center justify-center text-fg-faint text-sm">
        No linked map
      </div>
    );
  }

  return (
    <div className="flex-1 w-full min-h-0 relative flex flex-col">
      {isGmMode && <div className="absolute top-2 right-2 z-20 flex gap-2">
        <button type="button" className="rounded bg-surface-2 p-2 text-fg-primary disabled:opacity-40" disabled={history.cursor === 0} onClick={handleUndo}>Undo</button>
        <button type="button" className="rounded bg-surface-2 p-2 text-fg-primary disabled:opacity-40" disabled={history.cursor >= history.actions.length} onClick={handleRedo}>Redo</button>
      </div>}
      {/* The map surface fills the container */}
      <Map3DView
          showGridLines={true}
        edges={resolvedEdges}
        onEdgeClick={handleEdgeClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        map={linkedMap}
        isGmMode={isGmMode}
        visionMode={linkedMap.visionMode}
        routeTileIds={losTileIds}
        visibleTileIds={visibleTileIds}
        tokens={tokens}
        paintModeActive={false}
        placingToken={false}
        onTileClick={handleTileClick}
        onTokenDragStart={handleTokenDragStart}
        onTokenDrop={handleTokenDrop}
      />

      {/* Token legend — positioned absolutely over the map surface */}
      <TokenOverlay
        map={linkedMap}
        participants={visibleParticipants}
        currentActorInstanceId={currentActorInstanceId}
        selectedParticipantId={selectedParticipantId}
        onSelectParticipant={onSelectParticipant}
        categoryColor={categoryColorClass}
        onOpenConditions={onOpenConditions}
      />
    </div>
  );
}

/**
 * TokenOverlay — floating legend panel showing placed/unplaced participant list.
 * Participant placement is summarized here while the shared surface owns terrain.
 */
function TokenOverlay({
  map,
  participants,
  currentActorInstanceId,
  selectedParticipantId,
  onSelectParticipant,
  categoryColor,
  onOpenConditions,
}: {
  map: MapModel;
  participants: Participant[];
  currentActorInstanceId: string;
  selectedParticipantId: string | null;
  onSelectParticipant: (id: string | null) => void;
  categoryColor: (cat: string) => string;
  onOpenConditions?: (instanceId: string, anchor: { x: number; y: number }) => void;
}) {
  const placedParticipants = participants.filter(p => participantPosition(map, p));
  const unplacedParticipants = participants.filter(p => !participantPosition(map, p));

  if (placedParticipants.length === 0 && unplacedParticipants.length === 0) return null;

  return (
    <div className="absolute top-2 left-2 z-20 bg-surface-0/90 border border-edge rounded-lg p-2 backdrop-blur-sm max-h-48 overflow-y-auto w-44">
      <div className="text-[10px] font-medium text-fg-muted mb-1 uppercase tracking-wide">
        Tokens
      </div>
      {placedParticipants.map((p) => {
        const pos = participantPosition(map, p);
        const isCurrent = p.instanceId === currentActorInstanceId;
        const isSelected = p.instanceId === selectedParticipantId;
        return (
          <div key={p.instanceId} className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onSelectParticipant(isSelected ? null : p.instanceId)}
              className={`flex-1 min-w-0 flex items-center gap-1.5 py-0.5 px-1 rounded text-[10px] text-left cursor-pointer hover:bg-surface-2/50 ${
                isCurrent
                  ? 'bg-accent-500/20 text-accent-200'
                  : isSelected
                    ? 'bg-yellow-500/20 text-yellow-200'
                    : 'text-fg-secondary'
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full border ${categoryColor(p.category)} flex-shrink-0`}
              />
              <span className="truncate">{p.name}</span>
              <span className="text-fg-faint ml-auto flex-shrink-0">
                {pos?.col},{pos?.row}
              </span>
            </button>
            {/* Phase 12a.6: map-surface condition entry (GM only — host gates the prop) */}
            {onOpenConditions && (
              <button
                type="button"
                onClick={(e) =>
                  onOpenConditions(p.instanceId, { x: e.clientX, y: e.clientY })
                }
                aria-label={`Manage conditions for ${p.name}`}
                title="Add / manage conditions"
                className="flex-none p-0.5 rounded text-fg-faint hover:text-purple-300 hover:bg-surface-2/70 transition-colors"
              >
                <Sparkles className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
      {unplacedParticipants.length > 0 && (
        <>
          <div className="text-[10px] text-fg-faint mt-1 mb-0.5">
            Unplaced{selectedParticipantId ? '' : ' · click to select'}:
          </div>
          {unplacedParticipants.map((p) => {
            const isSelected = p.instanceId === selectedParticipantId;
            return (
              <button
                key={p.instanceId}
                type="button"
                onClick={() => onSelectParticipant(isSelected ? null : p.instanceId)}
                className={`w-full flex items-center gap-1.5 py-0.5 px-1 rounded text-[10px] text-left cursor-pointer hover:bg-surface-2/50 ${
                  isSelected
                    ? 'bg-yellow-500/20 text-yellow-200'
                    : 'text-fg-faint'
                }`}
              >
                <div
                  className={`w-2.5 h-2.5 rounded-full border ${categoryColor(p.category)} ${isSelected ? '' : 'opacity-40'} flex-shrink-0`}
                />
                <span className="truncate">{p.name}</span>
                {isSelected && (
                  <span className="text-yellow-400 ml-auto text-[9px]">▶ click tile</span>
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
