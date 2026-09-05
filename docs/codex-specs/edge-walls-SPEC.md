# DISPATCH: edge walls and doors, wall-aware LOS — Phase 17a step 4

You are working in a git worktree on branch `codex/edge-walls` of a GURPS virtual tabletop
(React 18 + TypeScript strict + Vite + three.js; Vitest with jsdom). Do not commit. Do not run
`npm install` — `node_modules` (root and `server/`) is symlinked and complete. Do not touch
`server/`, `shared/`, or `src/net/`. Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`. Use
`import type` for type-only imports. Keep business logic out of components (reducers/utils).

**Prerequisite:** step 3 (`docs/codex-specs/footprints-SPEC.md`) is merged: `src/utils/footprint.ts`
exists with `indexFootprints`, layers carry `footprint`, and footprints never touch the map border.

## Reference prototype (read first, copy freely, never merge)

Branch `proto/footprints` (tip ad481e2), decision record in `PROTO_NOTES.md`. Relevant parts:

- `src/proto/footprints/model.ts` — the edge half: `edgeKey`, `splitEdgeKey`,
  `deriveBoundaryEdges`, `resolveEdges`, `cycleEdge`, `nextOverride`, `edgeBlocksSight`,
  `makeEdgeBlocker`, `footprintsMerged`. §2 below is this code, relocated.
- `src/utils/lineOfSight.ts` — the `blockedEdge` parameter threaded through
  `hasLineOfSightFromPos` / `hasLineOfSight` / `computeVisibleTiles`.
- `src/components/map/three/MapScene.ts` — `pickWithPoint`, `pickEdge`, `updateEdgeHover`,
  `edgePlacement`, `edgeMesh`, the edge part of `buildProto()`, the `dblclick` listener and the
  deferred edge click in `onPointerUp`.
- `src/components/map/MapPanel.tsx` — `resolvedEdges`, `handleEdgeClick`, `handleEdgeDoubleClick`,
  and the `makeEdgeBlocker` call in the `visibleTileIds` memo.
- `src/proto/footprints/__tests__/exercise.test.ts` — the edge/LOS/merge/expansion scenarios.

## Background (why)

Step 3 gave room stamps a footprint. Rooms need walls and doors: the boundary of a footprint is
where sight (and later movement) stops, a shared boundary between two rooms is an interior wall,
and a door is a wall segment with state. Nothing in the map model represents walls or doors today;
`revealedTileIds` + the Bresenham LOS in `src/utils/lineOfSight.ts` is the vision pipeline they
must plug into. This dispatch adds the edge model, GM/player interaction on edges, rendering, and
edge blocking in LOS. It is the tile-native answer to the parked "walls, doors, objects as
first-class map entities" item: edges, not free geometry.

## Design decisions (fixed — do not revisit)

1. **Edges are map-level and keyed by the sorted TileId pair** `${a}|${b}` (`a < b` as strings) of
   the two orthogonally adjacent tiles they separate. TileIds are stable, so keys survive map
   expansion. An edge on the map border (no neighbour) does not exist — step 3's expansion
   buffer guarantees footprints never need one.
2. **Footprints generate walls; overrides sit on top.** For every footprint, every edge between one
   of its tiles and an orthogonal neighbour outside it is a *derived wall*; an edge derived from
   two different footprints is an *interior* wall. `MapModel.edgeOverrides?: Record<EdgeKey, EdgeOverride>`
   with `EdgeOverride = { kind: 'wall' } | { kind: 'open' } | { kind: 'door'; state: 'open' | 'closed' | 'locked' }`
   records GM toggles. Effective state = `override ?? (derived ? wall : open)`. An override that
   equals the derived state is **deleted**, not stored. Overrides on non-boundary edges are
   legitimate: a `wall`/`door` there is a free-standing wall/door; an `open` there is dropped.
3. **Doors do not travel with rooms.** Moving or rotating a layer moves its derived walls; edge
   overrides stay where they are (they may then apply to another room's boundary, or become inert
   free-standing edges). Compose rooms first, then wire doors. Deleting a layer leaves its overrides
   in place (they become free-standing or inert); no pruning in this step.
4. **Interaction.** Pointer within **0.28 tile** of a tile side picks that edge (nearest side of the
   hit tile; the neighbour must exist). GM **double-click** cycles wall → door(closed) → open → wall
   (`nextOverride`). **Single click** on a door toggles open ↔ closed (anyone); **shift-click** on a
   door toggles locked ↔ closed (GM only); a locked door does not open for players, a GM click on a
   locked door opens it. A single click on an edge is **deferred 250 ms** and cancelled by a
   double-click on the same canvas, so a double-click never also toggles a door; a click that hits
   no door falls through to the normal tile click. Hovering within the pick band shows a thin white
   highlight bar on that edge (GM and players).
5. **Rendering.** Edges render as boxes along the tile side at the higher of the two tiles' floor
   heights: derived wall `#4a3728`, interior (two owners) `#7c5a3c`, free-standing wall `#3f4f6b`,
   1.0 long × 0.32 high × 0.08 thick; door closed `#d97706`, 0.7 × 0.26 × 0.12; door open = two
   0.1-long stubs at the ends of that segment; locked `#dc2626`. Vertical (same-row) edges are the
   same box rotated 90° about y. Visible to players (walls/doors are world, unlike footprint tints),
   subject to the tile being rendered under fog (`tileIsRendered` for either tile).
6. **LOS.** `hasLineOfSight` / `computeVisibleTiles` take an optional `blockedEdge(a, b)` predicate
   over consecutive Bresenham cells. It runs over **every** consecutive pair, endpoints included and
   *before* the `steps <= 1` shortcut (a wall between neighbours blocks). Orthogonal step: blocked iff
   the shared edge blocks sight (wall, closed door, locked door). **Diagonal step: blocked only when
   both L-shaped orthogonal routes around the corner are blocked** (each route = two edges, blocked
   if either blocks). Verified consequences (keep as tests): looking diagonally into a room's outside
   corner is blocked; a diagonal inside an L-shaped room is open; adjacent-through-wall is blocked;
   open door passes, closed/locked block; when every shared edge between two rooms is open the rooms
   are merged for sight.
7. All three `computeVisibleTiles` / `hasLineOfSight` callers (`src/components/map/MapPanel.tsx`,
   `src/components/combat/CombatMapPanel.tsx`, `src/state/party/journeyEngine.ts`) pass the map's
   blocker via the selector in §3 so vision is consistent everywhere.

## Deliverables

### 1. Types — `src/types/map.ts`

```ts
export type EdgeKey = string;                       // `${tileA}|${tileB}`, sorted
export type EdgeOverride =
  | { kind: 'wall' }
  | { kind: 'open' }
  | { kind: 'door'; state: 'open' | 'closed' | 'locked' };
```
On `MapModel`: `edgeOverrides?: Record<EdgeKey, EdgeOverride>;` (doc comment: decisions 1–3).

### 2. Pure model — new `src/utils/mapEdges.ts`

```ts
export type EdgeState = EdgeOverride & { layerIds: ImageLayerId[]; derived: boolean };
export function edgeKey(a: TileId, b: TileId): EdgeKey;
export function splitEdgeKey(key: EdgeKey): [TileId, TileId];
export function deriveBoundaryEdges(map: Pick<MapModel, 'grid' | 'rows' | 'cols'>, index: FootprintIndex): Map<EdgeKey, ImageLayerId[]>;
export function resolveEdges(map: Pick<MapModel, 'grid' | 'rows' | 'cols' | 'imageLayers' | 'edgeOverrides'>, index?: FootprintIndex): Map<EdgeKey, EdgeState>;
export function cycleEdge(current: EdgeOverride['kind']): EdgeOverride;      // wall → door(closed) → open → wall
export function nextOverride(state: EdgeState | undefined): EdgeOverride | null;  // null when the next state equals the derived one
export function edgeBlocksSight(state: EdgeState | undefined): boolean;
export type EdgeBlocker = (a: { row: number; col: number }, b: { row: number; col: number }) => boolean;
export function makeEdgeBlocker(map: Pick<MapModel, 'grid' | 'rows' | 'cols'>, states: Map<EdgeKey, EdgeState>): EdgeBlocker;
```
Bodies: copy from the prototype. `EdgeBlocker` is defined here and re-exported (type) from
`lineOfSight.ts`.

### 3. Selector — `src/state/selectors/mapEdges.ts` (new)

`selectResolvedEdges(map: MapModel): Map<EdgeKey, EdgeState>` and
`selectEdgeBlocker(map: MapModel): EdgeBlocker | undefined` (undefined when the map has no edges),
memoized on map identity (WeakMap keyed by the map object, like the existing memoized selectors —
match their pattern).

### 4. Actions + reducer + store

- `MAP_SET_EDGE_OVERRIDE = 'map/setEdgeOverride'`, payload `{ mapId; edgeKey; override: EdgeOverride | null }`.
- Reducer: create `edgeOverrides` lazily; `null` deletes the key; delete the object when it becomes
  empty is *not* required.
- `campaignStore.tsx`: `mapSetEdgeOverride(mapId, edgeKey, override)`.

### 5. LOS — `src/utils/lineOfSight.ts`

Add the optional `blockedEdge?: EdgeBlocker` parameter to `hasLineOfSightFromPos`,
`hasLineOfSight`, and `computeVisibleTiles` exactly as in the prototype (edge loop first, endpoints
included, then the existing elevation walk). Update the three callers (decision 7) to pass
`selectEdgeBlocker(map)`.

### 6. Renderer — `src/components/map/three/MapScene.ts` + `Map3DView.tsx`

- `TilePointerEvent` gains `shiftKey?: boolean`. New exported `EdgePick { a: TileId; b: TileId; key: EdgeKey }`.
- `MapSceneCallbacks`: `onEdgeClick?(edge: EdgePick, ev: TilePointerEvent): boolean` (true =
  consumed) and `onEdgeDoubleClick?(edge: EdgePick): void`. `Map3DView` bridges both as props.
- `MapSceneFrameData` gains `edges: Map<EdgeKey, EdgeState> | null` (the resolved map from §3;
  identity-compared for rebuilds).
- `pickWithPoint` / `pickEdge` / `updateEdgeHover` / `edgePlacement` / `edgeMesh` / `buildEdges()`
  per decisions 4–5 (copy from the prototype; the hover mesh is a `Group`). `buildEdges()` runs from
  `rebuildWorld()` and from `update()` when only `edges` changed. A `dblclick` listener on the canvas
  (bound/unbound with the others) cancels the pending deferred click and fires `onEdgeDoubleClick`.
  In `onPointerUp`'s click branch, when the left click is near an edge and `onEdgeClick` exists,
  defer as in the prototype (250 ms, `setTimeout`, cleared in `dispose()` and on double-click), and
  call `onTileClick` from the timer when the edge click was not consumed. Skip edge meshes whose
  tiles are both hidden by fog.

### 7. Map panel — `src/components/map/MapPanel.tsx` (and `CombatMapPanel.tsx` for clicks if it renders `Map3DView` — check)

`resolvedEdges = selectResolvedEdges(activeMap)`; pass `edges={resolvedEdges}` to `Map3DView`;
`handleEdgeClick` / `handleEdgeDoubleClick` per decision 4 (copy from the prototype, GM checks
included). Add one line to the paint HUD / help strip: "double-click an edge: wall → door → open ·
click a door: open/close · shift-click: lock" — GM only.

### 8. Tests

- New `src/utils/__tests__/mapEdges.test.ts`: `edgeKey` symmetric and sorted; two rooms A (1,1) 4×3
  and B (5,1) 3×3 on a 9×9 map → 23 boundary edges, 3 with two owners; carving A's bottom-right
  cell keeps 14 edges for A and drops shared to 2; `resolveEdges` applies overrides, drops
  `open`-on-open, and marks free-standing walls `derived: false`; `cycleEdge` / `nextOverride`
  sequence wall → door → open → wall returns `null` on the last step; `edgeBlocksSight` table.
- Extend `src/utils/__tests__/lineOfSight*.test.ts` (find the existing LOS tests): with a blocker —
  adjacent-through-wall blocked, outside-corner diagonal blocked, inside diagonal open, closed door
  blocks, open door passes, locked blocks; `computeVisibleTiles` from inside A excludes B's tiles
  until the shared door opens; all shared edges `open` → every B tile visible from A's far corner;
  without a blocker results are unchanged (regression).
- Extend `src/state/map/__tests__/mapLayers.test.ts` (or a new `mapEdges` reducer test): set,
  replace, and delete an override; `expandMap({ top: 2, left: 1 })` keeps every override key
  resolving to the same effective state.
- Extend `src/state/selectors` tests: `selectResolvedEdges` returns the same Map for the same map
  object and a new one after a reducer change.
- New `src/components/map/three/__tests__/MapScene.edges.test.ts`: with two adjacent footprint
  rooms the scene contains one edge group whose child count equals the resolved edge count; an
  `open` door renders two stubs; a vertical edge mesh has `rotation.y ≈ π/2` and sits at
  `x = 5, z = 2.5` for the edge between (col 4,row 2) and (col 5,row 2); `edges: null` renders
  nothing. Pick test: stub `Raycaster.prototype.intersectObject` to return a hit with `instanceId`
  and `point` 0.1 from the east side of tile (4,2) and assert the `dblclick` handler calls
  `onEdgeDoubleClick` with the key of (4,2)|(5,2); a click 0.5 from every side (tile center) calls
  `onTileClick`, not `onEdgeClick`; use fake timers for the 250 ms deferral (click then dblclick →
  only the double-click callback fires).
- Extend the MapPanel or a small handler test: player click on a locked door leaves state
  unchanged; GM shift-click toggles locked; GM double-click on open ground creates a free-standing
  wall override.

## Definition of done — run these yourself and fix failures before finishing

```
npx tsc --noEmit -p tsconfig.json
npx vitest run src/utils/__tests__ src/state src/components/map
npx vitest run            # full client suite, must be green
npm run check:tokens
npx vite build
```

Do not modify unrelated tests to make them pass. Do not add dependencies. No `src/proto/`, no
`PROTO` markers.

## Final summary (required)

One paragraph on: the exact diagonal rule as implemented and which test pins it; how the deferred
single click interacts with `onTileClick` and `dispose()`; how fog hides edges; where the three
LOS callers obtain the blocker; and any place where the prototype was not followed and why. List
every file created or modified.
