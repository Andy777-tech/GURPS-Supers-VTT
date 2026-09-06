# DISPATCH: stamp library panel + measure-to-fit — Phase 17a step 5

You are working in a git worktree on branch `codex/stamp-library` of a GURPS virtual tabletop
(React 18 + TypeScript strict + Vite + three.js; Vitest with jsdom). Do not commit. Do not run
`npm install` — `node_modules` (root and `server/`) is symlinked and complete. Do not touch
`server/`, `shared/`, or `src/net/`. Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`. Use
`import type` for type-only imports. Keep business logic out of components (reducers/utils).
Tailwind classes must use the semantic tokens (`bg-surface-*`, `border-edge*`, `text-fg-*`,
`bg-accent-*`, `text-danger-*` — copy the vocabulary from `src/components/map/views/ImageLayersDialog.tsx`);
raw palette classes fail `npm run check:tokens`.

**Prerequisites (all merged, read them first):**
- `docs/codex-specs/asset-store-A-SPEC.md` — content-addressed asset store: `src/assets/assetStore.ts`
  (`getAssetStore().put/get/getObjectUrl`), `src/assets/importImage.ts` (`importImage(file)` →
  `{ assetId, mime, aspect }`), `src/assets/useAssetUrl.ts`, `src/assets/assetMigration.ts`
  (`collectReferencedAssetIds` drives pruning and export bundling).
- `docs/codex-specs/image-layer-transform-SPEC.md` — `rotation`/`mirrorX`/`mirrorY`/`locked` on
  `MapImageLayer`; `src/utils/imageLayerTransform.ts`.
- `docs/codex-specs/footprints-SPEC.md` — `footprint: FootprintCell[]` on layers,
  `src/utils/footprints.ts` (`defaultFootprint`, `rotateFootprint`, `projectFootprint`, `clipFootprint`).
- `docs/codex-specs/edge-walls-SPEC.md` — walls/doors derive from footprints; nothing here changes edges.
- The align-3×3 drag in `src/components/map/three/MapScene.ts` (`alignMode`, `onAlignBoxComplete`,
  `alignRectGroup`) and `src/utils/imageAlign.ts` (`AlignBox`, `MIN_ALIGN_BOX`). The measure drag
  below **reuses this drag channel unchanged**.

## Background (why)

Steps 2–4 made an image layer behave like a room stamp: integer geometry, a footprint, walls and
doors on its boundary. What is missing is a *library*: the GM imports (or slices out of a bigger
map) a set of rooms, hallways and stairs once, tags them, and then composes a dungeon by measuring
a hole on the map and dropping in a stamp that fits. This dispatch adds the stamp collection to
campaign state, a GM-only side panel, a measure box drawn on the map that filters the library to
stamps whose footprint fits, one-click placement (rotated 90° when that is the only way to fit),
and the two import paths: a raw image file, and a tile rectangle sliced out of an existing layer.
The art is the user's; we ship no stamps.

## Design decisions (fixed — do not revisit)

1. **Stamps live in the maps slice**: `MapState.stamps?: Record<StampId, MapStamp>` (the type of
   `state.maps`, which holds `mapsById`; see `src/state/map/mapReducer.ts` and the `MapState` type).
   Optional, absent on older saves. Persistence needs no migration: `hydrateCampaignState` merges
   slices over `createCampaignState()` defaults. Bump `CURRENT_SCHEMA_VERSION` in
   `src/utils/schemaVersioning.ts` to `'1.6.3'` ("Map stamp library", `breaking: false`,
   `migratesFrom: ['1.6.2']`, `features` listing the stamp library) and update
   `src/utils/__tests__/schemaVersioning.test.ts` accordingly.
2. **A stamp is metadata plus an asset reference**, never inline pixels:
   ```ts
   export type StampId = string;
   export type StampCategory = 'background' | 'room' | 'hallway' | 'stairs';
   export interface MapStamp {
     id: StampId;
     name: string;
     category: StampCategory;
     assetId: AssetId;
     mime?: string;
     /** Footprint box in whole tiles, both >= 1. */
     width: number;
     height: number;
     /** Owned cells within the box (sorted, clipped). Undefined = the whole box. */
     footprint?: FootprintCell[];
     placement: ImageLayerPlacement;
     createdAt: number;
   }
   ```
   `collectReferencedAssetIds` in `src/assets/assetMigration.ts` must include every stamp's
   `assetId` (for `state.maps.stamps` and for each checkpoint snapshot's `maps.stamps`), otherwise
   pruning deletes the bytes and export omits them.
3. **Placement is a reducer action, not component code.** `placeStamp(stamp, anchor, rotation, layerId, elevation)`
   (pure, `src/utils/stamps.ts`) builds a `MapImageLayer`: `x = anchor.col`, `y = anchor.row`,
   `width/height` = stamp dims (swapped for rotation 90/270), `rotation`, `mirrorX/Y` false,
   `footprint` = `rotateFootprint` applied to `stamp.footprint ?? defaultFootprint(w, h)` the right
   number of quarter turns — **except `background` stamps, which place as plain images with no
   footprint** (backgrounds are floors, not rooms; no walls). `placement` from the stamp,
   `opacity 1`, `visible true`, `gmOnly false`, `locked false`, `elevation` = the anchor tile's
   effective elevation (tile `elevationOverride` ?? terrain elevation ?? `DEFAULT_TERRAIN_ELEVATION`;
   find the existing helper that resolves a tile's elevation in `src/utils/mapUtils.ts` and reuse it).
   The reducer pushes the layer and then runs the same footprint-aware border expansion paint uses
   (`expandMapIfNeededForPaint`) so a stamp dropped at the edge never violates step 3's
   "footprints never touch the border" contract.
4. **Measure box.** GM enters *measure* mode from the panel; the map shows the crosshair and the
   existing align rectangle drag (`alignMode={{ elevation }}` on `Map3DView`, `onAlignBoxComplete`).
   The completed box snaps to whole tiles with `snapMeasureBox(box: AlignBox): MeasureBox | null`
   where `MeasureBox = { col: number; row: number; width: number; height: number }`:
   `col = round(x)`, `row = round(y)`, `width = max(1, round(x + width) - col)`, same for height;
   `null` when either raw extent is below `MIN_ALIGN_BOX`. The snapped box stays on the map as a GM-only
   highlight until cleared (Esc, the panel's Clear button, or leaving the map), and measure mode
   ends after one drag (draw again via the panel button). While a box exists the panel shows
   "W × H tiles" and, by default, only stamps that fit.
5. **Fit rule.** `stampFits(stamp, box): 0 | 90 | null` — `0` when `stamp.width <= box.width &&
   stamp.height <= box.height`; otherwise `90` when the swapped dims fit; otherwise `null`. Same rule
   for every category. `filterStamps(stamps, { box, category, onlyFitting })` returns
   `{ stamp, rotation }[]` sorted by name; without a box everything matches with rotation `0`.
6. **Placing.** "Place" on a stamp row: with a box → anchor = `{ col: box.col, row: box.row }`,
   rotation from the fit, then the box is cleared. Without a box → the row becomes *armed*
   (`placingStampId`), the HUD says "Click a tile to place <name> · Esc cancels", the next GM tile
   click places at that tile with rotation 0. Placement also mirrors the peer-upload behaviour of
   `ImageLayersDialog.handleFile` (when `connectionManager.status === 'connected'` and
   `role === Role.GM`, fetch the bytes from the asset store and `uploadAsset(assetId, bytes, mime)`),
   because a stamp created offline may be placed while players are connected. Extract that snippet
   into `src/assets/uploadAssetToPeers.ts` (`uploadAssetToPeers(assetId: AssetId): Promise<void>`,
   no-op when not host) and use it from the dialog, from stamp import/slice, and from placement.
7. **Import paths** (all GM-only, all through the panel):
   - **Import file**: `importImage(file)`; the panel asks for a width in tiles (number input,
     default 4, min 1) and derives `height = max(1, round(width * aspect))`; category from the
     panel's current category selector (default `room`); name = file name without extension.
   - **From layer**: pick one of the active map's image layers (select); the stamp copies
     `assetId`, `mime`, `placement`, rounded `width/height` (min 1), `footprint` (clipped to that
     box; undefined stays undefined). No pixels are touched; the asset is shared with the layer.
   - **Slice from layer**: pick a layer, then draw a measure box over it; the pixels of that tile
     rectangle become a **new asset** and a stamp of the box's `width × height` (footprint = whole
     box). Pure geometry in `src/utils/stamps.ts`:
     `layerPixelRect(layer, imageW, imageH, box): { sx; sy; sw; sh } | null` — the source rectangle in
     the pixel space of the layer's image **after** its mirror and rotation have been applied
     (i.e. an image whose pixel box maps affinely onto `layer.x/y/width/height`), `null` when the box
     does not intersect the layer; clip to the intersection. Browser side in
     `src/assets/sliceLayerImage.ts`: `sliceLayerImage(layer, box): Promise<{ assetId; mime } | null>`
     loads the layer's image via `getAssetStore().getObjectUrl` (or `layer.src`), draws it onto a
     canvas with the **same mirror-then-rotate convention MapScene uses for image planes** (read
     `buildImageLayers` in `MapScene.ts` and match it), crops with `layerPixelRect`, encodes JPEG
     0.85 like `importImage`, and `put`s the bytes. Slicing a `locked` layer is allowed (it reads,
     never writes the layer).
8. **Editing.** Name (inline input) and category (select) are editable per row; delete asks no
   confirmation but is a small trash icon like the layer card; deleting a stamp never touches
   layers already placed from it. Stamps have no lock.
9. **Players see nothing.** The panel, measure highlight and armed-placement HUD are all gated on
   `isGmMode`. Stamp metadata syncs with the campaign state like everything else; that is fine.

## Deliverables

### 1. Types — `src/types/map.ts`
`StampId`, `StampCategory`, `MapStamp` (decision 2) with doc comments. Export `STAMP_CATEGORIES:
readonly StampCategory[]` from `src/utils/stamps.ts`, not from the types file.

### 2. Pure model — new `src/utils/stamps.ts`
```ts
export const STAMP_CATEGORIES: readonly StampCategory[];
export interface MeasureBox { col: number; row: number; width: number; height: number }
export function snapMeasureBox(box: AlignBox): MeasureBox | null;
export function stampFits(stamp: Pick<MapStamp, 'width' | 'height'>, box: MeasureBox): 0 | 90 | null;
export function filterStamps(stamps: readonly MapStamp[], opts: { box: MeasureBox | null; category: StampCategory | 'all'; onlyFitting: boolean }): { stamp: MapStamp; rotation: 0 | 90 }[];
export function placeStamp(stamp: MapStamp, anchor: { col: number; row: number }, rotation: ImageLayerRotation, layerId: ImageLayerId, elevation: number): MapImageLayer;
export function stampFromLayer(layer: MapImageLayer, id: StampId, category: StampCategory, createdAt: number): MapStamp | null;  // null when the layer has neither assetId nor src-derived asset (require assetId)
export function layerPixelRect(layer: Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height' | 'rotation'>, imageW: number, imageH: number, box: MeasureBox): { sx: number; sy: number; sw: number; sh: number } | null;
```
`imageW/imageH` in `layerPixelRect` are the dimensions of the *transformed* image (already swapped
for 90/270), so the function only needs the affine map from tile box to pixels; document that.

### 3. Actions + reducer + store
- `src/state/map/mapActions.ts`: `MAP_ADD_STAMP = 'map/addStamp'` `{ stamp: MapStamp }`;
  `MAP_UPDATE_STAMP = 'map/updateStamp'` `{ stampId; changes: Partial<Pick<MapStamp, 'name' | 'category' | 'placement'>> }`;
  `MAP_REMOVE_STAMP = 'map/removeStamp'` `{ stampId }`;
  `MAP_PLACE_STAMP = 'map/placeStamp'` `{ mapId; stampId; anchor: { col; row }; rotation: ImageLayerRotation; layerId: ImageLayerId }`.
  Action creators, payload interfaces, union members and the `isMapAction` guard updated.
- `src/state/map/mapReducer.ts`: create `stamps` lazily; update ignores unknown ids; place is a
  no-op for an unknown stamp or map, otherwise decision 3.
- `src/state/campaignStore.tsx`: `mapAddStamp(stamp)`, `mapUpdateStamp(stampId, changes)`,
  `mapRemoveStamp(stampId)`, `mapPlaceStamp(mapId, stampId, anchor, rotation): ImageLayerId`
  (generates the layer id with the same `img_…` scheme the dialog uses and returns it).
- `src/assets/assetMigration.ts`: decision 2. `src/utils/schemaVersioning.ts`: decision 1.

### 4. Renderer — `src/components/map/three/MapScene.ts` + `Map3DView.tsx`
`MapSceneFrameData.measureBox: MeasureBox | null` (new; identity-compared). Render it as a flat
translucent plane (`#38bdf8` at 0.25 opacity) plus a 0.06-wide outline of the same colour sitting
0.02 above the highest floor under the box, rebuilt from `update()` when `measureBox` changes and
from `rebuildWorld()`. Nothing else in the scene changes — the drag itself is the existing
`alignMode` channel. `Map3DView` gains `measureBox?: MeasureBox | null`.

### 5. Panel — new `src/components/map/views/StampLibraryPanel.tsx` (view only, props in / callbacks out)
A right-hand sidebar (`w-72`, `bg-surface-1 border-l border-edge`, scrollable) rendered by
`MapPanel` between `Map3DView` and the travel wizard when `isGmMode && showStampLibrary`. Toggle
button "Stamps" in `src/components/map/views/MapHeader.tsx` next to "Images" (GM only). Sections:
1. **Measure** — "Draw box" button (enters measure mode; label "Drawing… Esc cancels" while
   active), and when a box exists: "W × H tiles", "Only fitting" checkbox (default on), "Clear".
2. **Filter** — category chips `All / Background / Room / Hallway / Stairs`.
3. **Stamps** — rows: 40 px thumbnail (`useAssetUrl`), name input, category select, `w×h`, a
   "rotated" badge when the fit is 90, **Place** (primary), trash. Empty state text when nothing
   matches. Armed row highlighted.
4. **Add** — "Import file…" (hidden `<input type="file" accept="image/*">` + width-in-tiles input),
   "From layer" and "Slice from layer" each with a layer `<select>` over `map.imageLayers` (hidden
   when the map has no layers). "Slice" arms slicing: the next measure drag slices instead of
   measuring; the button reads "Draw the tile box to slice… Esc cancels" while armed.

Props (all data + callbacks; no store access inside):
```ts
interface StampLibraryPanelProps {
  map: MapModel; stamps: MapStamp[];
  measureBox: MeasureBox | null; measuring: boolean; slicingLayerId: ImageLayerId | null;
  placingStampId: StampId | null; category: StampCategory | 'all'; onlyFitting: boolean;
  onStartMeasure(): void; onClearBox(): void; onSetCategory(c: StampCategory | 'all'): void; onSetOnlyFitting(v: boolean): void;
  onPlace(stampId: StampId, rotation: 0 | 90): void; onUpdateStamp(stampId: StampId, changes: Partial<Pick<MapStamp, 'name' | 'category' | 'placement'>>): void; onRemoveStamp(stampId: StampId): void;
  onImportFile(file: File, widthTiles: number): void; onStampFromLayer(layerId: ImageLayerId): void; onStartSlice(layerId: ImageLayerId): void;
  onClose(): void;
}
```

### 6. Map panel — `src/components/map/MapPanel.tsx`
State: `showStampLibrary`, `measureMode: 'off' | 'measure' | 'slice'`, `slicingLayerId`,
`measureBox`, `placingStampId`, `stampCategory`, `onlyFitting`. Wire `alignMode` so it is active for
the align flow **or** measure/slice mode (elevation = active layer's for align, the map's default
floor for measure). In `handleAlignBoxComplete` branch on which flow is active: align →
existing; measure → `snapMeasureBox` → `setMeasureBox`; slice → `snapMeasureBox` →
`sliceLayerImage(layer, box)` → `mapAddStamp(...)` + `uploadAssetToPeers` → clear. Esc cancels
measure/slice/armed placement (extend the existing Esc handlers; do not break align's). A tile
click while `placingStampId` is set places and disarms (before the paint/select handling). The
panel and the `ImageLayersDialog` may be open at the same time; the existing align / footprint-edit
gates on the dialog stay as they are. HUD line while armed (decision 6) in the same bottom-right
strip as the footprint HUD.

### 7. Tests
- New `src/utils/__tests__/stamps.test.ts`: `snapMeasureBox` rounds each corner independently
  (`{x: 2.4, y: 0.6, width: 3.3, height: 1.9}` → `{col: 2, row: 1, width: 4, height: 2}`), min 1, null
  under `MIN_ALIGN_BOX`; `stampFits` table incl. 90 and null; `filterStamps` respects category and
  `onlyFitting` and returns rotation per stamp; `placeStamp` at rotation 0 and 90 (dims swap,
  footprint rotated once, notched footprint rotates correctly, background gets no footprint,
  elevation passed through); `stampFromLayer` copies and clips; `layerPixelRect` for an unrotated
  layer (x 2, y 1, 4×3 tiles, image 800×600 → box {3,1,2,2} → {sx 200, sy 0, sw 400, sh 400}),
  a rotated layer (imageW/H already swapped), partial overlap clipped, disjoint → null.
- New `src/state/map/__tests__/mapStamps.test.ts` (use `imageState` from
  `src/assets/__tests__/fixtures.ts` + `campaignReducer`): add/update/remove; place pushes a layer
  with the expected geometry and footprint; placing a 4×3 room at the map's bottom-right corner
  expands the map (rows/cols grow) and the layer's footprint tiles all exist; placing an unknown
  stamp is a no-op.
- Extend `src/assets/__tests__/assetMigration.test.ts` (find it; create if absent):
  `collectReferencedAssetIds` includes stamp assets from the live state and from a checkpoint;
  `pruneUnreferencedAssets` keeps them.
- New `src/components/map/three/__tests__/MapScene.measure.test.ts` (copy the three.js stub and
  canvas mock from `MapScene.edges.test.ts`): `measureBox` renders a group with the plane centred
  at `x = col + width/2`, `z = row + height/2` and outline children; `null` renders nothing;
  changing the box rebuilds only that group.
- New `src/components/map/views/__tests__/StampLibraryPanel.test.tsx` (`@testing-library/react`,
  mock `useAssetUrl`): with a 4×2 box and stamps 4×2, 2×4, 5×5 → two rows, the 2×4 row shows
  "rotated" and Place reports rotation 90; unchecking "Only fitting" shows all three; category chip
  filters; Import file with width 3 calls `onImportFile(file, 3)`.
- `src/utils/__tests__/schemaVersioning.test.ts` updated for 1.6.3.
- Update `ImageLayersDialog.test.tsx` only if extracting `uploadAssetToPeers` changes what it
  spies on; its peer-upload matrix must still pass.

## Definition of done — run these yourself and fix failures before finishing

```
npx tsc --noEmit -p tsconfig.json
npx vitest run src/utils/__tests__ src/state src/components/map src/assets
npx vitest run            # full client suite, must be green
npm run check:tokens
npx vite build
```

Do not modify unrelated tests to make them pass. Do not add dependencies. No `src/proto/`, no
`PROTO` markers. The server-integration socket test may fail with EPERM in the sandbox; if it is
the only red test, say so in the summary rather than editing it.

## Final summary (required)

One paragraph on: the exact mirror/rotate convention `sliceLayerImage` matches and where in
`MapScene.ts` you read it; how measure/slice reuse the align drag without breaking align and Esc;
how placement triggers border expansion and which test pins it; where stamp asset ids enter
`collectReferencedAssetIds`; and any place where this spec was not followed and why. List every
file created or modified.

## Follow-ups

### F1. Measure/slice drag plane ignores the floor under the pointer (decided 2026-09-06)

**Defect.** §6 wires the measure/slice drag with `alignMode={{ elevation: DEFAULT_TERRAIN_ELEVATION }}`
(`MapPanel.tsx:992`), so `pickGroundPoint` (`MapScene.ts:823`) intersects a plane at the default
floor. The camera is perspective-only (`MapScene.ts:154`, no orthographic toggle), so on any raised
floor the ray hits the default plane at the wrong x/z. Reproduced by independent review: a 2×2 box
dragged on a floor at elevation 6 snaps to `{col:3,row:0,w:2,h:3}` instead of `{col:3,row:3,w:2,h:2}`.
The fit filter, the placement anchor and the slice crop all use the wrong tiles; `buildMeasureBox`
raising the completed highlight to the true surface (`MapScene.ts:1162-1172`) does not repair the
intersection that produced the box. FIX1 lists this as out of scope.

**Decision: fix it with (b) + (a); reject (c) and (d).**

- **Slice-from-layer uses the sliced layer's elevation.** `MapImageLayer.elevation` exists
  (`src/types/map.ts:269`), so the target floor is known before the drag starts. This is the same
  shape as the align flow (`{ elevation: aligningLayer.elevation }`); the slice branch passes
  `{ elevation: slicingLayer.elevation }`. This is the half that matters most: a wrong slice crop
  bakes the wrong pixels into a stamp asset, which is a data bug rather than a visual one.
- **Free measure locks the plane to the tile under the pointer at pointer-down.** `pickWithPoint`
  (`MapScene.ts:521`) already raycasts the tile instanced mesh and returns the tile entry;
  `tileHeight(tileId)` (`MapScene.ts:960`) gives its effective elevation. At pointer-down in
  measure mode, resolve that elevation once and use it for `alignPlaneHeight()` for the rest of the
  drag (move and up). Pointer-down off the map falls back to the prop elevation
  (`DEFAULT_TERRAIN_ELEVATION`). Structure-layer tops are not considered, which matches the
  placement rule in this spec (anchor elevation = `elevationOverride` ?? terrain elevation).
- **Why not (c), per-frame raycast against tile tops.** A box spanning two floors has no single
  elevation, and placement already collapses a stamp to one anchor elevation. A planar box locked
  at the elevation the user started on is predictable and matches what placement will do with it.
  Per-frame instanced-mesh raycasts also add cost for no gain in the single-floor case, which is
  the common case once multi-floor maps are handled by linked maps (ROADMAP §17a blocker).
- **Why not (d), document and defer.** The tactical-scale tier is where stamps "only make sense"
  (ROADMAP §17a) and where raised platforms in a 1 yd/square dungeon will be routine, so the
  limitation would surface exactly when the feature starts being used in earnest.

**Ordering.** ROADMAP §17a has no step 6; the list ends at step 5 and the tactical-scale tier is the
next blocker. Ship this as its own small Codex dispatch (`stamp-library-FIX2-SPEC.md`, or
`DISPATCH-stamp-measure-elevation.md` in the project root) after FIX1 lands and before any
tactical-tier work starts. Step 5 lands with the default-floor behaviour as written.

**Tests the fix must pin.** (1) The review repro: perspective camera, floor at elevation 6, drag
that visually covers a 2×2 → `{col:3,row:3,w:2,h:2}`. (2) Slice with the pointer over a tile whose
elevation differs from the layer's → the plane uses the layer's elevation. (3) Measure pointer-down
off the map → default-floor plane, no throw. (4) Align flow and Esc handling unchanged (existing
`MapScene.transform` / edges tests stay green).
