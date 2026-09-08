/**
 * Map Actions
 *
 * Action type constants and type definitions for map-related state changes.
 */

import type {
  MapId,
  MapStamp,
  StampId,
  ImageLayerRotation,
  TileId,
  TerrainId,
  MarkerId,
  LinkId,
  ImageLayerId,
  FootprintCell,
  EdgeKey,
  EdgeOverride,
  StructureLayerId,
  MapScale,
  TerrainModel,
  MarkerModel,
  LinkModel,
  MapImageLayer,
  StructureLayer,
  MapModel,
} from '../../types/map';
import type { ClimateType } from '../../types/location';
import type { CellPosition, MapTokenModel, MapTokenReference } from '../../types/map';
import type { CombatState, LogEntry } from '../../types/combatTracker';

export type TokenAction =
  | { type: 'map/addToken'; payload: { mapId: string; token: MapTokenModel } }
  | { type: 'map/updateToken'; payload: { mapId: string; tokenId: string; changes: Partial<Omit<MapTokenModel, 'id' | 'position'>> } }
  | { type: 'map/removeToken'; payload: MapTokenReference }
  | { type: 'map/moveToken'; payload: { mapId: string; tokenId?: string; participantId?: string; position: CellPosition; mode: 'gm' | 'combat'; path?: string[]; costYards?: number; logEntry?: LogEntry } }
  | { type: 'map/restoreCombatMove'; payload: { combat: CombatState; tokenRef?: MapTokenReference; tileId?: string; createdToken?: MapTokenModel; removeCreatedToken?: boolean } };

// ============================================================================
// ACTION TYPE CONSTANTS
// ============================================================================

// Map CRUD
export const MAP_CREATE = 'map/createMap' as const;
export const MAP_DELETE = 'map/deleteMap' as const;
export const MAP_UPDATE = 'map/updateMap' as const;
export const MAP_SET_ACTIVE = 'map/setActiveMap' as const;

// Terrain editing (tile assignment)
export const MAP_SET_TILE_TERRAIN = 'map/setTileTerrain' as const;
export const MAP_STAMP_TERRAIN = 'map/stampTerrain' as const;
export const MAP_SET_TILE_ELEVATION = 'map/setTileElevation' as const;

// Terrain definitions
export const MAP_ADD_TERRAIN = 'map/addTerrain' as const;
export const MAP_UPDATE_TERRAIN = 'map/updateTerrain' as const;
export const MAP_REMOVE_TERRAIN = 'map/removeTerrain' as const;

// Markers
export const MAP_ADD_MARKER = 'map/addMarker' as const;
export const MAP_UPDATE_MARKER = 'map/updateMarker' as const;
export const MAP_REMOVE_MARKER = 'map/removeMarker' as const;

// Links
export const MAP_ADD_LINK = 'map/addLink' as const;
export const MAP_REMOVE_LINK = 'map/removeLink' as const;

// Stamp library
export const MAP_ADD_STAMP = 'map/addStamp' as const;
export const MAP_UPDATE_STAMP = 'map/updateStamp' as const;
export const MAP_REMOVE_STAMP = 'map/removeStamp' as const;
export const MAP_PLACE_STAMP = 'map/placeStamp' as const;

export interface AddStampPayload { stamp: MapStamp }
export interface UpdateStampPayload {
  stampId: StampId;
  changes: Partial<Pick<MapStamp, 'name' | 'category' | 'placement'>>;
}
export interface RemoveStampPayload { stampId: StampId }
export interface PlaceStampPayload {
  mapId: MapId;
  stampId: StampId;
  anchor: { col: number; row: number };
  rotation: ImageLayerRotation;
  layerId: ImageLayerId;
}
export type AddStampAction = { type: typeof MAP_ADD_STAMP; payload: AddStampPayload };
export type UpdateStampAction = { type: typeof MAP_UPDATE_STAMP; payload: UpdateStampPayload };
export type RemoveStampAction = { type: typeof MAP_REMOVE_STAMP; payload: RemoveStampPayload };
export type PlaceStampAction = { type: typeof MAP_PLACE_STAMP; payload: PlaceStampPayload };
export const addStamp = (payload: AddStampPayload): AddStampAction => ({ type: MAP_ADD_STAMP, payload });
export const updateStamp = (payload: UpdateStampPayload): UpdateStampAction => ({ type: MAP_UPDATE_STAMP, payload });
export const removeStamp = (payload: RemoveStampPayload): RemoveStampAction => ({ type: MAP_REMOVE_STAMP, payload });
export const placeStamp = (payload: PlaceStampPayload): PlaceStampAction => ({ type: MAP_PLACE_STAMP, payload });

// Image layers
export const MAP_ADD_IMAGE_LAYER = 'map/addImageLayer' as const;
export const MAP_UPDATE_IMAGE_LAYER = 'map/updateImageLayer' as const;
export const MAP_SET_EDGE_OVERRIDE = 'map/setEdgeOverride' as const;
export const MAP_SET_FOOTPRINT = 'map/setFootprint' as const;
export const MAP_ROTATE_IMAGE_LAYER = 'map/rotateImageLayer' as const;
export const MAP_REMOVE_IMAGE_LAYER = 'map/removeImageLayer' as const;

// Structure layers
export const MAP_ADD_STRUCTURE_LAYER = 'map/addStructureLayer' as const;
export const MAP_UPDATE_STRUCTURE_LAYER = 'map/updateStructureLayer' as const;
export const MAP_REMOVE_STRUCTURE_LAYER = 'map/removeStructureLayer' as const;
export const MAP_SET_STRUCTURE_CELLS = 'map/setStructureCells' as const;

// Reveal & position
export const MAP_REVEAL_TILES = 'map/revealTiles' as const;

// Pending terrain assignment
export const MAP_SET_PENDING_TERRAIN = 'map/setPendingTerrain' as const;
export const MAP_CLEAR_PENDING_TERRAIN = 'map/clearPendingTerrain' as const;

// ============================================================================
// ACTION TYPES
// ============================================================================

export type CreateMapAction = {
  type: typeof MAP_CREATE;
  payload: {
    name: string;
    description?: string;
    scale: MapScale;
    weatherTableId?: MapModel['weatherTableId'];
    linkFrom?: { mapId: MapId; tileId: TileId; label?: string };
    startTerrainId: TerrainId;
    climate: ClimateType;
  };
};

export type DeleteMapAction = {
  type: typeof MAP_DELETE;
  payload: MapId;
};

export type UpdateMapAction = {
  type: typeof MAP_UPDATE;
  payload: {
    mapId: MapId;
    changes: Partial<Pick<MapModel, 'name' | 'description' | 'visionMode' | 'sightRangeTiles' | 'climate' | 'weatherTableId' | 'travelEventTableSetId'>>;
  };
};

export type SetActiveMapAction = {
  type: typeof MAP_SET_ACTIVE;
  payload: MapId | null;
};

export type SetTileTerrainAction = {
  type: typeof MAP_SET_TILE_TERRAIN;
  /** elevationOverride: absent = leave the tile's override alone; a number = paint that elevation. */
  payload: { mapId: MapId; tileId: TileId; terrainId: TerrainId; elevationOverride?: number };
};

export type StampTerrainAction = {
  type: typeof MAP_STAMP_TERRAIN;
  payload: { mapId: MapId; tileIds: TileId[]; terrainId: TerrainId; elevationOverride?: number };
};

export type SetTileElevationAction = {
  type: typeof MAP_SET_TILE_ELEVATION;
  payload: { mapId: MapId; tileIds: TileId[]; elevation: number | null };
};

export type AddTerrainAction = {
  type: typeof MAP_ADD_TERRAIN;
  payload: { mapId: MapId; terrain: TerrainModel };
};

export type UpdateTerrainAction = {
  type: typeof MAP_UPDATE_TERRAIN;
  payload: { mapId: MapId; terrainId: TerrainId; changes: Partial<TerrainModel> };
};

export type RemoveTerrainAction = {
  type: typeof MAP_REMOVE_TERRAIN;
  payload: { mapId: MapId; terrainId: TerrainId };
};

export type AddMarkerAction = {
  type: typeof MAP_ADD_MARKER;
  payload: { mapId: MapId; marker: MarkerModel };
};

export type UpdateMarkerAction = {
  type: typeof MAP_UPDATE_MARKER;
  payload: { mapId: MapId; markerId: MarkerId; changes: Partial<MarkerModel> };
};

export type RemoveMarkerAction = {
  type: typeof MAP_REMOVE_MARKER;
  payload: { mapId: MapId; markerId: MarkerId };
};

export type AddLinkAction = {
  type: typeof MAP_ADD_LINK;
  payload: { link: LinkModel };
};

export type RemoveLinkAction = {
  type: typeof MAP_REMOVE_LINK;
  payload: { mapId: MapId; linkId: LinkId };
};

export type AddImageLayerAction = {
  type: typeof MAP_ADD_IMAGE_LAYER;
  payload: { mapId: MapId; layer: MapImageLayer };
};

export type UpdateImageLayerAction = {
  type: typeof MAP_UPDATE_IMAGE_LAYER;
  payload: { mapId: MapId; layerId: ImageLayerId; changes: Partial<Omit<MapImageLayer, 'id'>> };
};

export type SetEdgeOverrideAction = {
  type: typeof MAP_SET_EDGE_OVERRIDE;
  payload: { mapId: MapId; edgeKey: EdgeKey; override: EdgeOverride | null };
};

export type SetFootprintAction = {
  type: typeof MAP_SET_FOOTPRINT;
  payload: { mapId: MapId; layerId: ImageLayerId; footprint: FootprintCell[] | undefined };
};

export type RotateImageLayerAction = {
  type: typeof MAP_ROTATE_IMAGE_LAYER;
  payload: { mapId: MapId; layerId: ImageLayerId; direction: 'cw' | 'ccw' };
};

export type RemoveImageLayerAction = {
  type: typeof MAP_REMOVE_IMAGE_LAYER;
  payload: { mapId: MapId; layerId: ImageLayerId };
};

export type AddStructureLayerAction = {
  type: typeof MAP_ADD_STRUCTURE_LAYER;
  payload: { mapId: MapId; layer: StructureLayer };
};

export type UpdateStructureLayerAction = {
  type: typeof MAP_UPDATE_STRUCTURE_LAYER;
  payload: {
    mapId: MapId;
    layerId: StructureLayerId;
    changes: Partial<Omit<StructureLayer, 'id' | 'cells'>>;
  };
};

export type RemoveStructureLayerAction = {
  type: typeof MAP_REMOVE_STRUCTURE_LAYER;
  payload: { mapId: MapId; layerId: StructureLayerId };
};

export type SetStructureCellsAction = {
  type: typeof MAP_SET_STRUCTURE_CELLS;
  /** terrainId null = erase the cells from the layer */
  payload: { mapId: MapId; layerId: StructureLayerId; tileIds: TileId[]; terrainId: TerrainId | null };
};

export type RevealTilesAction = {
  type: typeof MAP_REVEAL_TILES;
  payload: { mapId: MapId; tileIds: TileId[] };
};

export type SetPendingTerrainAction = {
  type: typeof MAP_SET_PENDING_TERRAIN;
  payload: TileId[];
};

export type ClearPendingTerrainAction = {
  type: typeof MAP_CLEAR_PENDING_TERRAIN;
};

// ============================================================================
// UNION TYPE
// ============================================================================

export type MapAction =
  | TokenAction
  | AddStampAction
  | UpdateStampAction
  | RemoveStampAction
  | PlaceStampAction
  | CreateMapAction
  | DeleteMapAction
  | UpdateMapAction
  | SetActiveMapAction
  | SetTileTerrainAction
  | StampTerrainAction
  | SetTileElevationAction
  | AddTerrainAction
  | UpdateTerrainAction
  | RemoveTerrainAction
  | AddMarkerAction
  | UpdateMarkerAction
  | RemoveMarkerAction
  | AddLinkAction
  | RemoveLinkAction
  | AddImageLayerAction
  | UpdateImageLayerAction
  | SetEdgeOverrideAction
  | SetFootprintAction
  | RotateImageLayerAction
  | RemoveImageLayerAction
  | AddStructureLayerAction
  | UpdateStructureLayerAction
  | RemoveStructureLayerAction
  | SetStructureCellsAction
  | RevealTilesAction
  | SetPendingTerrainAction
  | ClearPendingTerrainAction;

// ============================================================================
// TYPE GUARD
// ============================================================================

const MAP_ACTION_TYPES = new Set<string>([
  'map/addToken', 'map/updateToken', 'map/removeToken', 'map/moveToken', 'map/restoreCombatMove',
  MAP_ADD_STAMP, MAP_UPDATE_STAMP, MAP_REMOVE_STAMP, MAP_PLACE_STAMP,
  MAP_CREATE,
  MAP_DELETE,
  MAP_UPDATE,
  MAP_SET_ACTIVE,
  MAP_SET_TILE_TERRAIN,
  MAP_STAMP_TERRAIN,
  MAP_SET_TILE_ELEVATION,
  MAP_ADD_TERRAIN,
  MAP_UPDATE_TERRAIN,
  MAP_REMOVE_TERRAIN,
  MAP_ADD_MARKER,
  MAP_UPDATE_MARKER,
  MAP_REMOVE_MARKER,
  MAP_ADD_LINK,
  MAP_REMOVE_LINK,
  MAP_ADD_IMAGE_LAYER,
  MAP_UPDATE_IMAGE_LAYER,
  MAP_SET_FOOTPRINT,
  MAP_SET_EDGE_OVERRIDE,
  MAP_ROTATE_IMAGE_LAYER,
  MAP_REMOVE_IMAGE_LAYER,
  MAP_ADD_STRUCTURE_LAYER,
  MAP_UPDATE_STRUCTURE_LAYER,
  MAP_REMOVE_STRUCTURE_LAYER,
  MAP_SET_STRUCTURE_CELLS,
  MAP_REVEAL_TILES,
  MAP_SET_PENDING_TERRAIN,
  MAP_CLEAR_PENDING_TERRAIN,
]);

export function isMapAction(action: { type: string }): action is MapAction {
  return MAP_ACTION_TYPES.has(action.type);
}
