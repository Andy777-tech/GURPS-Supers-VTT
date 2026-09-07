# DISPATCH: tactical scale tier — scale type, 1 yd rung, migration 1.6.4, grid-line layer — Phase 17b step 1

You are working in a git worktree on branch `codex/tactical-scale` of a GURPS virtual tabletop
(React 18 + TypeScript strict + Vite + three.js; Vitest with jsdom). Do not commit. Do not run
`npm install` — `node_modules` (root and `server/`) is symlinked and complete. Do not touch
`server/`, `shared/`, or `src/net/` (the wire format is an opaque state blob; nothing there reads
map scale). Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`. Use `import type` for
type-only imports. Keep business logic out of components (reducers/utils). Do not create anything
under `src/proto/` and do not leave anything named `proto`/`PROTO` in the tree.

**Prerequisites (all merged):** 17a steps 3–5 — `src/utils/footprints.ts`, `src/utils/mapEdges.ts`
(edge walls/doors, `makeEdgeBlocker`), `src/utils/lineOfSight.ts` with the `blockedEdge` hook,
`src/utils/stamps.ts`, and the three.js renderer `src/components/map/three/MapScene.ts`.

## Reference prototype (read first, copy the idea, never merge)

Branch `proto/tactical` (tip 446af48), decision record in `PROTO_NOTES.md` there. Read with
`git show 446af48:<path>`; do not check it out. The only part this step reuses is the grid-line
branch of `MapScene.buildProto()` (`git show 446af48:src/components/map/three/MapScene.ts`,
lines ~1000–1017): one `THREE.LineSegments` built from a flat `Float32BufferAttribute`, four
2-point segments per rendered tile at that tile's own `tileHeight(tileId) + 0.012`,
`LineBasicMaterial({ color: '#05070a', transparent: true, opacity: 0.75, depthWrite: false })`,
`renderOrder = 950`. Everything else on that branch (map-id check, HUD buttons, path/arc code,
`src/proto/tactical/*`) is throwaway and out of scope.

## Background (why)

Maps today carry `scaleMilesPerTile: MapScale` with `MapScale = 12 | 50 | 457` (miles per tile)
and every travel construct (modes, router, journey engine, wizard copy) assumes miles. Phase 17b
adds a person-scale tier — 1 yard per square (GURPS B384) — so the room stamps, edge walls,
doors and LOS from 17a can host tactical combat. Later steps add tokens, movement enforcement,
overlays and multi-floor links; this step lays the rails: a unit-carrying scale type, the
tactical rung with no overland travel, a real schema rewrite, boundary-as-wall for LOS, creating
a tactical map linked from a world tile with climate copied once, and the drawn grid-line layer
the prototype proved necessary (gap-grid cells vanish under image stamps at 30×30).

This spec implements ROADMAP.md §17b **decisions 1, 3, 4, 5** and the prototype-gate verdict
**(c)**. Decisions 2, 6–15 belong to later steps — do not implement them.

## Design decisions (fixed — do not revisit)

1. **Unit-carrying scale, string rungs (decision 4).** `MapScale` becomes
   `'1yd' | '12mi' | '50mi' | '457mi'` and `MapModel.scaleMilesPerTile` is **renamed** to
   `MapModel.scale: MapScale`. A field named "miles per tile" cannot honestly carry yards. All
   rung facts live in one exhaustive `SCALE_DEFINITIONS: Record<MapScale, MapScaleDefinition>`
   (unit, value, tier, label, description, cell noun) and every label/picker/description derives
   from it. No caller hard-codes `12`, `'mi/tile'` or the word "mile" any more.
2. **Two tiers.** `tier: 'tactical' | 'overland'`; `'1yd'` is the only tactical rung. Predicates
   `isTacticalScale(scale)` / `isRoutableMap(map)` are the single gate every consumer uses. Square
   cells only (decision 1 of §17b): nothing hex-shaped is introduced.
3. **Explicit `'none'` travel mode (decision 4).** `TravelMode` becomes
   `'foot' | 'boat' | 'airship' | 'none'`; `OverlandTravelMode = Exclude<TravelMode, 'none'>`.
   `SCALE_TO_MODES` stays an exhaustive `Record<MapScale, readonly TravelMode[]>` with
   `'1yd': ['none']`. Everything that models *actual* travel — terrain `perMode`, vehicle types,
   journeys, `TRAVEL_MODE_DEFINITIONS`, `getNavigationSkill`, the router and engine mode
   parameters — is typed `OverlandTravelMode`; `'none'` never reaches them. `TerrainModel.perMode`
   therefore keeps its three keys and every terrain literal/fixture stays untouched.
4. **Router / engine refuse tactical maps (decision 4).** `findRoute`, `computeRouteMiles`,
   `getReachableTiles` and the journey engine never route on a map whose tier is tactical. No
   throws, no `Result` type: the router's existing sentinel shape gains a `reason`, the validator
   emits a new blocker code, the engine pauses the journey (`pauseReason: 'noRoute'`). Follow the
   three existing precedents exactly (see deliverable 4).
5. **Map boundary is an implicit wall on the tactical rung (decision 3).** LOS: an edge between an
   in-map tile and an off-map cell blocks sight on tactical maps; on overland maps behaviour is
   unchanged (off-map is transparent). No edge keys for phantom cells — `EdgeKey` stays a sorted
   `TileId` pair and nothing is persisted for the border. Movement enforcement is step 3; this step
   only ships the predicate and the LOS behaviour. The renderer draws the border as a wall ring on
   tactical maps so the rule is visible.
6. **Standalone authoring + world link, climate copied once (decision 5).** A tactical map is a
   normal map created from the create dialog. When the dialog is opened while an overland map is
   active, choosing the 1 yd rung pre-fills climate from that map and offers "Link from
   `<map>` at the selected tile" (checked by default when a tile is selected). Creation and the
   link are one reducer action, so the new map's id never has to round-trip through the UI.
   No generation from the parent tile, no parent pointer, no live hierarchy: after creation the
   link in `linksById` is the only relationship.
7. **Grid-line layer (prototype verdict (c)).** Drawn only on tactical maps, per rendered tile
   (fog-respecting), dark `#05070a` at 0.75 opacity, `depthWrite: false`, at
   `tileHeight + 0.012`, `renderOrder 950`: above underlay image planes (0) and footprint tints
   (900/901), below overlay image planes (1000+), the editing outline (1500) and the measure box
   (2000+). Players always see it; the GM has a transient view toggle (default on), like
   `showFootprints`. Nothing about the toggle is persisted.
8. **Schema 1.6.4 is a real rewrite (decision 4).** Every persisted map is rewritten from the
   numeric `scaleMilesPerTile` to the string `scale`; the migration is idempotent, operates on raw
   `MigratableData` with `isRecord` guards, returns the input by reference when nothing changed,
   and is covered by tests in the style of `src/utils/__tests__/travelStateMigration.test.ts`.
9. **Defaults.** New overland maps stay 9×9 (`INITIAL_GRID_SIZE`); new tactical maps start
   30×30 (`TACTICAL_INITIAL_GRID_SIZE = 30`, matching the prototype's legibility test). The
   dialog's default rung stays `'12mi'`. Scale remains immutable after creation (`UpdateMapAction`
   unchanged).

## Deliverables

### 1. Types — `src/types/map.ts`

- `export type MapScale = '1yd' | '12mi' | '50mi' | '457mi';` with a doc comment listing the rungs.
- `export type ScaleUnit = 'yd' | 'mi'; export type ScaleTier = 'tactical' | 'overland';`
- `export interface MapScaleDefinition { id: MapScale; unit: ScaleUnit; value: number; tier: ScaleTier; label: string; description: string; cellNoun: 'square' | 'tile' }`
  (`'1yd'` → value 1, yd, tactical, label `Tactical`, description `1 yard per square — combat, interiors`, cellNoun `square`; the three mile rungs keep their current labels/descriptions, cellNoun `tile`).
- `MapModel.scale: MapScale` replaces `scaleMilesPerTile` (line ~328). Update the doc comment.
- `TravelMode` gains `'none'`; add `OverlandTravelMode`. Narrow `TerrainModel.perMode` (line ~97),
  `TravelModeDefinition.id` / `allowedScales` (line ~442–445) to overland. Delete the dead
  `allowedScales` field if nothing reads it after your change (grep first; it is unread today).
- `TRAVEL_BLOCKER_CODES` gains `SCALE_NOT_ROUTABLE: 'SCALE_NOT_ROUTABLE'`.
- `src/types/party.ts`: `VehicleTypeDef.mode` and `Journey.mode` become `OverlandTravelMode`.

### 2. Constants + pure helpers — `src/constants/map.ts`, new `src/utils/mapScale.ts`

- `src/constants/map.ts`: `SCALE_DEFINITIONS: Record<MapScale, MapScaleDefinition>`;
  `MAP_SCALES` becomes `Object.values(SCALE_DEFINITIONS)` in rung order `'1yd','12mi','50mi','457mi'`
  (so the picker cannot drift from the record); `SCALE_TO_MODES: Record<MapScale, readonly TravelMode[]>`
  with `'1yd': ['none']`, `'12mi': ['foot','boat','airship']`, `'50mi': ['boat','airship']`,
  `'457mi': ['airship']`; `TRAVEL_MODE_DEFINITIONS` keyed/typed by `OverlandTravelMode`;
  `getTravelModeDefinition(mode: OverlandTravelMode)` — remove the non-null `!` by making the
  record exhaustive (`Record<OverlandTravelMode, TravelModeDefinition>`) or by a typed lookup, no
  throw path; `TACTICAL_INITIAL_GRID_SIZE = 30`.
- `src/utils/mapScale.ts` (pure, no React):
  - `isTacticalScale(scale: MapScale): boolean`
  - `isRoutableMap(map: Pick<MapModel, 'scale'>): boolean` (= overland tier)
  - `overlandMilesPerTile(scale: MapScale): number | null` (`null` for tactical — callers must
    guard by tier first; never `?? 0`)
  - `formatMapScale(scale: MapScale): string` → `1 yd/square`, `12 mi/tile`, `50 mi/tile`, `457 mi/tile`
  - `travelModesForScale(scale: MapScale): readonly TravelMode[]` (thin wrapper over `SCALE_TO_MODES`)
  - `legacyScaleToRung(value: unknown): MapScale` — `12 → '12mi'`, `50 → '50mi'`, `457 → '457mi'`,
    an already-valid rung string returns itself, anything else → `'12mi'`. Used by the migration
    and by nothing else.
  - `initialGridSizeForScale(scale: MapScale): number`.

### 3. Map factory + creation — `src/utils/mapUtils.ts`, `src/state/map/mapActions.ts`, `src/state/map/mapReducer.ts`, `src/state/campaignStore.tsx`

- `createInitialGrid(startTerrainId, size = INITIAL_GRID_SIZE)`; `createNewMap` takes
  `scale: MapScale` (not `scaleMilesPerTile`), optional `weatherTableId`, and sizes the grid with
  `initialGridSizeForScale(scale)`. It writes `scale`, never `scaleMilesPerTile`.
- `CreateMapAction.payload`: `scale: MapScale` replaces `scaleMilesPerTile`; add optional
  `weatherTableId?: Id | null` (the `MapModel.weatherTableId` type) and optional
  `linkFrom?: { mapId: MapId; tileId: TileId; label?: string }`.
- Reducer `MAP_CREATE`: after creating the map, if `linkFrom` is present and both the source map
  and source tile exist, build a `LinkModel` (`id: crypto.randomUUID()`, `fromMapId/fromTileId`
  from `linkFrom`, `toMapId` = new map, `toTileId` = the new map's centre tile
  `grid[Math.floor(rows/2)][Math.floor(cols/2)]`, `label` = `linkFrom.label ?? newMap.name`) and
  register it exactly the way `MAP_ADD_LINK` does (`fromMap.linksById[id]`, push onto
  `fromTile.linkIds`). If the source map/tile is missing, create the map and skip the link (no
  throw). Factor the "register a link" body into a local helper shared by both cases.
- `campaignStore.tsx`: `mapCreateMap` parameter type updated in **both** declarations (interface
  ~line 410 and implementation ~line 846).

### 4. Travel refusal — `src/utils/mapRouter.ts`, `src/utils/mapTravelValidation.ts`, `src/state/party/journeyEngine.ts`, `src/utils/navigation.ts`

- `RouteResult` gains `reason?: 'missing-tile' | 'no-path' | 'not-routable'`; the two existing
  failure returns set `'missing-tile'` / `'no-path'`. `findRoute` returns
  `{ path: [], totalCost: Infinity, valid: false, reason: 'not-routable' }` before any search when
  `!isRoutableMap(map)`; `getReachableTiles` returns an empty `Set`; `computeRouteMiles` returns
  `Infinity`. Mode parameters become `OverlandTravelMode`. Replace `map.scaleMilesPerTile` with
  `overlandMilesPerTile(map.scale)` *after* the tier guard, narrowing without `!`/casts (e.g.
  early-return on `null`).
- `mapTravelValidation.ts`: `validateTravelRoute` emits `SCALE_NOT_ROUTABLE` first and returns
  immediately when `!isRoutableMap(map)` (message: `` `${map.name} is a ${formatMapScale(map.scale)} map — no overland travel here.` ``).
  The mode-incompatibility message uses `formatMapScale` instead of `${n}-mile maps`.
- `journeyEngine.ts`: `stepCost` uses `overlandMilesPerTile`; the per-journey progression pauses
  the journey with `pauseReason: 'noRoute'` and a `travelLog.paused(...)` line reading
  `"<group> paused: no overland travel at <scale label>"` and skips it when its map is not
  routable (cannot happen through the wizard after this change, but journeys can pre-date it).
  Keep the guard before any distance math so no `null` mile value is ever used.
- `navigation.ts`: `getNavigationSkill(character, mode: OverlandTravelMode)`.
- `src/components/manager/views/VehiclesView.tsx` `MODES` and
  `src/components/map/views/TerrainEditor.tsx` `TRAVEL_MODES` are typed `OverlandTravelMode[]`.

### 5. Migration 1.6.4 — `src/utils/schemaVersioning.ts`, `src/utils/dataMigrations.ts`

- `CURRENT_SCHEMA_VERSION = '1.6.4'`; `SCHEMA_METADATA['1.6.4']` with `migratesFrom: ['1.6.3']`,
  description `Map scale becomes a unit-carrying rung (scale: '1yd' | '12mi' | '50mi' | '457mi'); scaleMilesPerTile removed`.
- `migrationHandlers['1.6.3:1.6.4'] = migrateTo1_6_4`. `migrateTo1_6_4(data)` walks
  `data.maps.mapsById` (guard every level with `isRecord`); for each map:
  - legacy key `'scaleMilesPerTile'` present → `scale = legacyScaleToRung(value)`, drop the legacy
    key with `omitKeys`;
  - otherwise `scale` missing/invalid → `scale = '12mi'`;
  - otherwise unchanged (same object reference).
  Plain string literals for the legacy key with the house comment ("Legacy keys are intentionally
  plain string literals for migration honesty."). Return `data` by reference when no map changed.
- `src/persistence/campaignStorage.ts` spreads the map object, so nothing to change there;
  confirm `exportImport.ts` (which imports `CURRENT_SCHEMA_VERSION`) needs no edit beyond the
  constant. `grep -rn scaleMilesPerTile src` after your change must return only: the migration,
  migration tests' legacy fixtures, and nothing else (seed/sample JSON included — if any ship a
  map, rewrite them to `scale`).

### 6. LOS boundary — `src/utils/mapEdges.ts`, `src/utils/lineOfSight.ts`, `src/state/selectors/mapEdges.ts`

- `mapEdges.ts`: export `boundaryBlocksSight(map: Pick<MapModel, 'scale'>): boolean` (= tactical).
  `makeEdgeBlocker(map, states, options?: { boundaryBlocks?: boolean })` — when set, a step whose
  `a` or `b` is off-map returns `true` (blocked) instead of `false`. Diagonal rule unchanged.
  Update the doc comment at lines ~21–25 to say the border is an implicit wall on tactical maps.
- `src/state/selectors/mapEdges.ts` `selectEdgeBlocker(map)`: pass
  `{ boundaryBlocks: boundaryBlocksSight(map) }`; on a tactical map it must return a blocker even
  when the map has no resolved edges (today it returns `undefined` for `edges.size === 0` —
  keep that short-circuit for overland only). Keep the per-map cache correct (the map object is
  the cache key, so this is automatic).
- `lineOfSight.ts` `hasLineOfSightFromPos`: an off-map cell on the ray returns `false` when
  `boundaryBlocksSight(map)`; otherwise `continue` as today. Both endpoints of any real query are
  in-bounds on a rectangular grid, so this mostly hardens the helper; the `makeEdgeBlocker` change
  is what players will observe.

### 7. Renderer — `src/components/map/three/MapScene.ts`, `src/components/map/views/Map3DView.tsx`

- `MapSceneFrameData.gridLines: boolean`.
- New `private gridGroup` + `private buildGridLines()`: dispose/rebuild; when
  `this.data.gridLines && isTacticalScale(this.data.map.scale)`, build the `LineSegments` as in
  the prototype (see "Reference prototype") over `this.pickEntries` (rendered tiles only), constant
  `GRID_LINE_RENDER_ORDER = 950` next to the footprint constants with a one-line comment stating
  its neighbours (underlay 0 / tints 900–901 below; overlays 1000+ above). Call it from
  `rebuildWorld()` after `buildImageLayers`, and in `update()` when
  `oldData.gridLines !== data.gridLines` (without a full rebuild). Never draw it on overland maps
  regardless of the flag.
- Border wall ring: in `buildEdges()` (or a sibling `buildBoundaryWalls()` called right after),
  when the map is tactical, add one wall segment per border side per rendered tile using the same
  geometry/height as a derived wall (`edgeMesh`/`edgePlacement` reuse — extend them to accept an
  explicit placement if needed), derived-wall colour `#4a3728`, not pickable (do not register in
  edge picking; `pickEdge` must still return nothing for a border side), not persisted. Skip on
  overland maps.
- `Map3DView.tsx`: prop `showGridLines?: boolean`; frame `gridLines: props.showGridLines ?? true`
  (players never pass it, so they always see the grid). Add it to the frame memo's dependency list.

### 8. Map panel + dialogs — `src/components/map/MapPanel.tsx`, `MapCreateDialog.tsx`, `MapHeader.tsx`, `LinkEditor.tsx`, `LinksMenu.tsx`, `TravelWizard.tsx`, `TravelStep1Party.tsx`, `CombatMapPanel.tsx`

- `MapPanel.tsx`: `const [showGridLines, setShowGridLines] = useState(true)`; a toolbar button
  `Grid` (aria-pressed) rendered only when `isGmMode && isTacticalScale(activeMap.scale)`, passed
  to `Map3DView` as `showGridLines`. `travelMode` derivation becomes
  `isRoutableMap(map) ? (stagedVehicleType?.mode ?? 'foot') : 'none'`, and every travel affordance
  (Travel button/wizard entry, reachable overlay, route preview) is hidden or inert when the mode
  is `'none'`. `handleCreateMap` forwards the new payload shape (`scale`, `weatherTableId`,
  `linkFrom`). The dialog receives `sourceMap` = the active overland map (`{ id, name, climate,
  weatherTableId, selectedTileId }`, `selectedTileId` = the sole member of `selectedTileIds` when its size is exactly 1, else `null`) when
  one is active, else `undefined`.
- `MapCreateDialog.tsx`: `onConfirm` params `{ name, description?, scale, startTerrainId, climate, weatherTableId?, linkFrom? }`;
  optional prop `sourceMap`. Four rungs in a 2×2 radiogroup (`grid-cols-2`); each option shows
  `formatMapScale(id)` + label, aria-label `${label} — ${description}`. Choosing `'1yd'` with a
  `sourceMap` present sets climate to `sourceMap.climate` (once, on rung change; the user can still
  change it) and shows the checkbox `Link from <sourceMap.name> at the selected tile` (checked by
  default; disabled with helper text `Select a tile on <name> first` when `selectedTileId` is
  null). Switching back to an overland rung hides the checkbox and clears `linkFrom`. On confirm
  with the box checked: `linkFrom = { mapId, tileId }`, `weatherTableId = sourceMap.weatherTableId`.
- `MapHeader.tsx` (badge + dropdown), `LinkEditor.tsx`, `LinksMenu.tsx`: labels via
  `SCALE_DEFINITIONS[scale].label` / `formatMapScale`. No `mi/tile` string literals remain in
  `src/components`.
- `TravelWizard.tsx` / `TravelStep1Party.tsx`: `SCALE_TO_MODES[map.scale]`; the "Unavailable at …"
  copy uses `formatMapScale`. The wizard cannot be opened on a tactical map (MapPanel gate above),
  but if it is rendered with one it must show the `SCALE_NOT_ROUTABLE` blocker, not crash.
- `CombatMapPanel.tsx` renders `Map3DView` (line ~274): pass `showGridLines` (always `true`).
  Do **not** touch its 1-yard-per-tile movement or `Participant.position` — steps 2–3.

### 9. Tests (Vitest; follow the named files' patterns)

Update every fixture that sets `scaleMilesPerTile` (≈45 sites; start with
`src/assets/__tests__/fixtures.ts`, `src/utils/__tests__/mapRouter.test.ts`,
`mapTravelValidation.test.ts`, `mapUtils.test.ts`, `src/state/map/__tests__/mapReducer.test.ts`,
`src/components/map/views/__tests__/MapViewComponents.test.tsx`,
`src/__tests__/serializationRoundTrip.test.ts`, `src/unified/__tests__/UnifiedShell.test.tsx`,
`src/components/location/__tests__/LocationManager.test.tsx`) to `scale: '12mi'` etc. `tsc` will
find the rest. New/extended tests:

- `src/utils/__tests__/mapScale.test.ts` — every helper in §2 over all four rungs;
  `legacyScaleToRung` on 12/50/457, a valid rung string, `'12'`, `0`, `undefined`, `{}`.
- `src/utils/__tests__/mapScaleMigration.test.ts` — raw 1.6.3 fixture with three maps (12, 50,
  457) plus one with a bogus scale `7`: `migrateData(fixture, '1.6.3', '1.6.4')` lands at
  `schemaVersion '1.6.4'`, every map has `scale` and no `scaleMilesPerTile`, bogus → `'12mi'`;
  idempotence (`toEqual` on a second pass); reference identity when input is already migrated
  (`toBe`); non-map state untouched; a map that is not a record is left alone without throwing;
  `CURRENT_SCHEMA_VERSION`/metadata assertions in `schemaVersioning.test.ts` updated.
- `mapRouter.test.ts` — on a `'1yd'` map: `findRoute` invalid with `reason 'not-routable'`,
  `getReachableTiles` empty, `computeRouteMiles` `Infinity`; existing overland cases unchanged;
  the two legacy failure paths carry `'missing-tile'` / `'no-path'`.
- `mapTravelValidation.test.ts` — `SCALE_NOT_ROUTABLE` is the sole blocker on a tactical map;
  overland mode-incompatibility message contains `formatMapScale` output.
- `src/state/party/__tests__/journeyEngine.test.ts` — a journey on a
  tactical map pauses with `noRoute` and logs; a `'12mi'` journey still progresses.
- `src/utils/__tests__/mapEdges.test.ts` / `lineOfSight.test.ts` — with `boundaryBlocks`, a step
  to an off-map cell is blocked; without it, not; `selectEdgeBlocker` returns a blocker for an
  edge-less tactical map and `undefined` for an edge-less overland map.
- `src/state/map/__tests__/mapReducer.test.ts` — `MAP_CREATE` with `scale: '1yd'` yields a 30×30
  map; with `linkFrom` it also writes one link on the source map/tile pointing at the new map's
  centre tile; with a missing source tile it creates the map and no link.
- `src/components/map/three/__tests__/MapScene.grid.test.ts` (pattern:
  `MapScene.measure.test.ts`) — tactical map + `gridLines: true` → the scene contains one
  `LineSegments` with `renderOrder 950` and `4 × renderedTiles` segments (position count
  `renderedTiles × 8 × 3`); `gridLines: false` → none; `'12mi'` map + `true` → none; toggling the
  flag via `update()` adds/removes it without a full rebuild (spy on `rebuildWorld` or assert the
  tile mesh identity is preserved). Border walls: a tactical 3×3 map has 12 non-pickable border
  wall meshes; an overland map has none; `pickEdge` on a border side returns null.
- `MapViewComponents.test.tsx` (or a new `MapCreateDialog.test.tsx`) — four rung options
  rendered; choosing Tactical with a `sourceMap` pre-fills climate and shows the link checkbox;
  confirm emits `scale: '1yd'`, `linkFrom`, `weatherTableId`; no `sourceMap` → no checkbox;
  overland rung → no `linkFrom`.
- `serializationRoundTrip.test.ts` — round-trips a `'1yd'` map.

## Definition of done — run these yourself and fix failures before finishing

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run src/utils src/state src/components/map src/__tests__ src/assets src/persistence
npx vitest run            # full suite must stay green (draken runs it in ~15 s)
npm run check:tokens
npx vite build
grep -rn "scaleMilesPerTile" src --include='*.ts' --include='*.tsx' --include='*.json'   # migration + legacy test fixtures only
grep -rn "mi/tile\|-mile maps" src/components src/utils                                  # no hits
grep -rni "proto" src/components/map src/utils/mapScale.ts                               # no hits
```

Do not skip or `.only` tests. If a test in the existing suite encodes the old numeric scale, update
the fixture; do not weaken the assertion.

## Final summary (required)

One paragraph on design decisions, especially: (1) how `'none'` is kept out of every
`OverlandTravelMode` consumer without casts; (2) exactly which `Record<MapScale, …>` /
`Record<TravelMode, …>` sites the compiler forced you to visit; (3) how the migration treats
unknown numeric scales and already-migrated data; (4) the grid-line rebuild path in `update()`
and the border-wall mesh count formula; (5) anything in the spec you could not do as written and
what you did instead. Then the actual test totals (files/tests passed) from the full run.
