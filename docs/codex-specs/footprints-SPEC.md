# DISPATCH: image layer footprints + shape editing — Phase 17a step 3

You are working in a git worktree on branch `codex/footprints` of a GURPS virtual tabletop
(React 18 + TypeScript strict + Vite + three.js; Vitest with jsdom). Do not commit. Do not run
`npm install` — `node_modules` (root and `server/`) is symlinked and complete. Do not touch
`server/`, `shared/`, or `src/net/`. Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`. Use
`import type` for type-only imports. Keep business logic out of components (reducers/utils).

## Reference prototype (read first, copy freely, never merge)

Branch `proto/footprints` (tip 9e72fae) holds a working throwaway prototype of this step and
the next one, with its decision record in `PROTO_NOTES.md`. Read these files there before coding:

- `src/proto/footprints/model.ts` — the pure model. The footprint half of it (`defaultFootprint`,
  `layerAnchor`, `sortCells`, `rotateFootprint`, `mirrorFootprint`, `editFootprint`,
  `projectFootprint`, `indexFootprints`, `cellKey`) is what §2 below asks for, verbatim apart from
  the file location and doc comments. Ignore the edge half (`edgeKey`, `resolveEdges`, …) — that is
  step 4 (`docs/codex-specs/edge-walls-SPEC.md`).
- `src/state/map/mapReducer.ts` — the `MAP_SET_FOOTPRINT` case and the footprint hooks inside
  `MAP_ROTATE_IMAGE_LAYER` / `MAP_UPDATE_IMAGE_LAYER`.
- `src/components/map/three/MapScene.ts` `buildProto()` — footprint tints, editing outline and
  the overlap checkerboard (keep those; drop the edge meshes and `pickEdge`).
- `src/components/map/MapPanel.tsx` — the block marked `PROTO 17a steps 3/4` (edit-mode state,
  `paintTile` branch, `handleTilePaintStart` first-tile rule, arrow nudge, HUD). Production keeps
  **variant B only** (see decision 6); delete the A/B switcher and `localStorage` persistence.
- `src/proto/footprints/__tests__/exercise.test.ts` — the scenarios; turn the footprint ones into
  the unit tests of §7.

Prototype code is throwaway: no `src/proto/` directory, no `PROTO` comments, no variant switcher
in the result.

## Background (why)

Map image layers (`MapImageLayer`, `src/types/map.ts` ~:200) are imported images on the tile
grid: `x/y/width/height` in tile units (the rotated footprint box since step 2), `rotation`
(0|90|180|270 clockwise in grid coords), `mirrorX/mirrorY` (image space, before rotation),
`locked`. The room-stamp composer (ROADMAP 17a) composes many small room images on one map. A
room needs to know which tiles it *owns*: that set drives the overlap hint while composing, the
snapping of a future drag-move, and (step 4) the walls and doors on its boundary. This dispatch
adds the footprint: the data, the transforms that keep it glued to the image through rotate /
mirror / move / map expansion, a brush-based shape editor, and the overlap checkerboard.

## Design decisions (fixed — do not revisit)

1. **Representation.** `footprint?: FootprintCell[]` on `MapImageLayer`, where
   `FootprintCell = [dx: number, dy: number]` is an integer offset from the layer's **anchor**
   `(round(x), round(y))`, confined to `0 ≤ dx < round(width)`, `0 ≤ dy < round(height)`. Stored
   sorted by `dy` then `dx` (`sortCells`). `undefined` means *no footprint*: a plain image with no
   overlap hint and (step 4) no walls. Footprints are **opt-in** per layer.
2. **The stamp contract.** A layer with a footprint has integer `x/y/width/height`. Enabling a
   footprint snaps the layer (`round` x/y, `max(1, round)` width/height). While a footprint exists,
   `MAP_UPDATE_IMAGE_LAYER` rounds any incoming `x/y/width/height` to integers and clips cells that
   fall outside the new box. Fractional images (battlemaps aligned with Align 3×3) simply do not
   get footprints.
3. **Rotate.** Cells rotate within the box: cw `(dx,dy) → (h−1−dy, dx)`, ccw `(dx,dy) → (dy, w−1−dx)`
   (w/h = the box *before* the turn). This is the cell-level version of step 2's corner table (cw
   moves the image's top-left to the top-right). A layer **with a footprint pivots on its top-left
   corner**: `x/y` unchanged, width/height swap, `rotation` steps — so four turns are the identity
   and geometry stays integer. Layers without a footprint keep step 2's center pivot
   (`rotateImageLayer`) unchanged.
4. **Mirror.** Toggling `mirrorX` / `mirrorY` flips the image in image space before rotation, so in
   rendered (grid) space the flip axis is conjugated by the rotation: `mirrorX` is a horizontal
   flip `(dx → w−1−dx)` at rotation 0/180 and a vertical flip `(dy → h−1−dy)` at 90/270; `mirrorY`
   the other way round. The reducer applies this to the footprint whenever a mirror flag actually
   changes value.
5. **Map expansion is free.** `expandMap` already offsets `x/y` when rows/cols are prepended, so
   offsets need nothing. In addition, `checkPaintExpansionNeeded` must treat projected footprint
   tiles like painted tiles, so a footprint never sits on the map border (step 4 needs a
   neighbour tile on every side of every footprint tile).
6. **Editing UX (prototype variant B).** "Edit shape" on a layer card hides the dialog and enters
   an edit mode that reuses the terrain brush plumbing (`getBrushTiles`, `onTilePaintStart` /
   `onTilePaintEnter` → `paintTile`). **The first tile of a drag decides**: if it is outside the
   footprint the drag *adds*, if inside it *removes*; the whole brush (size/shape from the palette,
   Ctrl+wheel still resizes) applies that mode. Cells outside the layer's box are ignored (the image
   has no art there). Arrow keys nudge the layer one tile (through `MAP_UPDATE_IMAGE_LAYER`), Esc or
   a "Done" control leaves the mode; the mode also ends if the layer disappears or the map switches.
7. **Rendering.** Footprint tiles render as a translucent tint (one palette color per layer index,
   opacity 0.18; 0.45 for the layer being edited, plus a white outline of its box). Tiles covered by
   two or more footprints render a **yellow/black 4×4 checkerboard** (Czepeku's cue) above the tints.
   Tints are GM-only and can be hidden; the checkerboard is GM-only too (players never see
   footprints in this step).
8. **Lock.** `footprint` joins `LOCKED_IMAGE_LAYER_KEYS`; `MAP_SET_FOOTPRINT` is a no-op on a locked
   layer; the dialog disables the footprint buttons while locked.
9. Persistence: the field is optional, exports carry it verbatim, no migration; confirm
   `src/assets/assetMigration.ts` preserves it (it spreads the layer).

## Deliverables

### 1. Types — `src/types/map.ts`

```ts
/** One footprint cell: integer offset [dx, dy] from the layer anchor (round(x), round(y)). */
export type FootprintCell = [dx: number, dy: number];
```
On `MapImageLayer` (doc comment stating decisions 1–2):
```ts
  footprint?: FootprintCell[];
```

### 2. Pure model — new `src/utils/footprints.ts`

```ts
import type { FootprintCell, MapImageLayer, MapModel, TileId } from '../types/map';

export const cellKey: (dx: number, dy: number) => string;             // `${dx},${dy}`
export function defaultFootprint(width: number, height: number): FootprintCell[];   // whole box, sorted
export function layerAnchor(layer: Pick<MapImageLayer, 'x' | 'y'>): { col: number; row: number };
export function sortCells(cells: FootprintCell[]): FootprintCell[];   // by dy then dx
export function rotateFootprint(cells: readonly FootprintCell[], width: number, height: number, direction: 'cw' | 'ccw'): FootprintCell[];
export function mirrorFootprint(cells: readonly FootprintCell[], width: number, height: number, axis: 'mirrorX' | 'mirrorY', rotation: number | undefined): FootprintCell[];
export function clipFootprint(cells: readonly FootprintCell[], width: number, height: number): FootprintCell[]; // drop cells outside the box
/** Add/remove the given tiles (absolute ids) to/from the layer's footprint; out-of-box tiles ignored; undefined footprint = box. */
export function editFootprint(map: Pick<MapModel, 'grid' | 'rows' | 'cols'>, layer: Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height' | 'footprint'>, tileIds: readonly TileId[], mode: 'add' | 'remove'): FootprintCell[];
/** Absolute tile ids covered by the footprint (cells off the grid dropped; no footprint → empty). */
export function projectFootprint(map: Pick<MapModel, 'grid' | 'rows' | 'cols'>, layer: Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height' | 'footprint'>): Set<TileId>;
export interface FootprintIndex { byLayer: Map<ImageLayerId, Set<TileId>>; byTile: Map<TileId, ImageLayerId[]>; overlap: Set<TileId>; }
export function indexFootprints(map: Pick<MapModel, 'grid' | 'rows' | 'cols' | 'imageLayers'>): FootprintIndex;
```
Bodies: copy from the prototype's `model.ts`.

### 3. Actions + reducer + store

- `src/state/map/mapActions.ts`: `MAP_SET_FOOTPRINT = 'map/setFootprint'`, payload
  `{ mapId; layerId; footprint: FootprintCell[] | undefined }`; add to the union and the type set.
- `src/state/map/mapReducer.ts`:
  - `MAP_SET_FOOTPRINT`: no-op if the layer is missing or locked. If enabling (`footprint` given and
    the layer had none) snap geometry per decision 2. Assign `clipFootprint(sortCells(footprint))`
    (or `undefined`).
  - `MAP_ROTATE_IMAGE_LAYER`: if the layer has a footprint, rotate cells first
    (`rotateFootprint(cells, width, height, direction)`), apply `rotateImageLayer`, then restore
    the pre-rotation `x/y` (corner pivot, decision 3). No footprint → unchanged behavior.
  - `MAP_UPDATE_IMAGE_LAYER`: before assignment, if the layer has a footprint and is not locked:
    for each of `mirrorX`/`mirrorY` present in `changes` whose boolean value differs from the
    layer's, apply `mirrorFootprint`; round incoming `x/y/width/height`. After assignment, clip the
    footprint to the (rounded) box. Keep the existing lock/normalize/clamp logic.
- `src/utils/imageLayerTransform.ts`: add `'footprint'` to `LOCKED_IMAGE_LAYER_KEYS`.
- `src/utils/mapUtils.ts` `checkPaintExpansionNeeded`: include every tile in
  `indexFootprints(map).byTile` in the bounding-box scan (accept the `imageLayers` field in its
  `Pick`; callers pass the full map already — verify `expandMapIfNeededForPaint`).
- `src/state/campaignStore.tsx`: `mapSetFootprint(mapId, layerId, footprint)` next to
  `mapRotateImageLayer`.

### 4. Renderer — `src/components/map/three/MapScene.ts`

- `MapSceneFrameData` gains `footprints: { editingLayerId: ImageLayerId | null; showTints: boolean } | null`
  (`null` = render nothing for this feature).
- New `buildFootprints()` called from `rebuildWorld()` after `buildImageLayers()`, and also
  re-run from `update()` when only the `footprints` field changed (identity compare, like the
  prototype's `oldData.proto !== data.proto` branch). Contents per decision 7: per layer with a
  footprint an `InstancedMesh(PlaneGeometry(0.98, 0.98))` of tints at `tileHeight(tile) + 0.03`,
  palette `['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#f87171'][layerIndex % 6]`;
  a `LineSegments` box outline for the editing layer at the layer's floor height + 0.05
  (`depthTest: false`, renderOrder 1500); one `InstancedMesh` with a 4×4 yellow/black
  `CanvasTexture` (NearestFilter) at +0.04 for `index.overlap`. Dispose everything in
  `disposeWorld()`; cache the checker texture on the instance and dispose it in `dispose()`.

### 5. Map panel — `src/components/map/MapPanel.tsx` + `src/components/map/views/Map3DView.tsx`

- `Map3DView` prop `footprints?: MapSceneFrameData['footprints']`, forwarded in the update
  effect (add to the dependency list).
- `MapPanel` state: `editingFootprintLayerId`, resolved to `editingFootprintLayer` (null unless
  the layer exists and has a footprint); a `useRef` for the drag mode. Effects: clear the id when
  the layer resolves to null; while editing, a `keydown` listener for Escape (leave), arrows
  (`mapUpdateImageLayer` ±1 on x/y, `preventDefault`).
- `paintTile`: when `editingFootprintLayer` is set, dispatch `mapSetFootprint(…, editFootprint(activeMap, layer, brushTileIds, dragModeRef.current))`
  and return before the terrain/structure branches. `handleTilePaintStart`: when editing, set
  `dragModeRef.current = projectFootprint(activeMap, layer).has(tileId) ? 'remove' : 'add'` and
  paint regardless of `interactionMode`. `paintModeActive` becomes true while editing (GM, not in
  the travel wizard).
- `footprints` frame prop: `{ editingLayerId, showTints: isGmMode }` for the GM, `null` for
  players. `ImageLayersDialog` is hidden while editing (same pattern as `aligningLayer`).
- Edit-mode strip: reuse the paint HUD slot (`paintHud`) or a sibling strip in `Map3DView`,
  showing "Editing footprint: {name} · {n} tiles · drag outside adds, inside removes · arrows
  nudge · Esc done" and a **Done** button. Use existing theme token classes only
  (`npm run check:tokens` gates them).

### 6. GM dialog — `src/components/map/views/ImageLayersDialog.tsx`

New props on `ImageLayersDialog` and `LayerCard`:
`onSetFootprint(layerId, footprint | undefined)`, `onEditFootprint(layerId)`. A "Footprint" row
above the transform row: without a footprint a button **Enable footprint** (title: "Give this image
a tile footprint (snaps it to whole tiles)") calling `onSetFootprint(id, defaultFootprint(width, height))`;
with one, the cell count ("12 tiles"), **Edit shape** (`onEditFootprint`), **Reset to box**, and
**Remove footprint** (`onSetFootprint(id, undefined)`). All disabled while locked. `MapPanel` wires
`onSetFootprint` → `actions.mapSetFootprint` and `onEditFootprint` → `setEditingFootprintLayerId`.

### 7. Tests (Vitest; follow the named files' patterns)

- New `src/utils/__tests__/footprints.test.ts`: `defaultFootprint(4,3)` = 12 sorted cells;
  `rotateFootprint` cw on a 4×3 set missing `[3,2]` yields a 3×4 set missing `[0,3]`; ccw is the
  inverse; four cw turns are the identity; `mirrorFootprint` at rotation 0 flips dx, at 90 flips
  dy, at 180 flips dx, at 270 flips dy (both axes); `editFootprint` add/remove, ignores out-of-box
  tiles, and starts from the box when `footprint` is undefined; `clipFootprint`;
  `projectFootprint` before and after `expandMap({ top: 2, left: 1 })` yields the same TileIds;
  `indexFootprints` reports `overlap` = 5 for the prototype's layout (A at (1,1) 4×3 missing its
  bottom-right cell, B at (3,1) 3×3).
- Extend `src/state/map/__tests__/mapLayers.test.ts`: enabling a footprint on `x: 1.4, width: 3.6`
  snaps to `x: 1, width: 4`; rotate with a footprint keeps `x/y` and swaps w/h (and cells rotate);
  rotate without a footprint still recenters (step 2 behavior, regression); `mirrorX: true` flips
  the cells; a width change from 4 to 3 clips `dx === 3` cells; `MAP_SET_FOOTPRINT` on a locked
  layer is a no-op; `MAP_UPDATE_IMAGE_LAYER` with `{ footprint }` on a locked layer is stripped.
- Extend the `mapUtils` expansion tests: `checkPaintExpansionNeeded` requests expansion when a
  footprint tile sits within the buffer of the border while no terrain is painted there.
- New `src/components/map/three/__tests__/MapScene.footprints.test.ts` (modelled on
  `MapScene.transform.test.ts`): after `update()` with two overlapping footprint layers, the
  scene contains an `InstancedMesh` per layer with `count` = its tile count, and one checkerboard
  `InstancedMesh` with `count` = overlap size; with `footprints: null` none of them exist;
  changing only `editingLayerId` rebuilds the footprint group without rebuilding image layers
  (spy on `TextureLoader.prototype.load` or count `Scene.add` calls).
- Extend `src/components/map/views/__tests__/ImageLayersDialog.test.tsx`: **Enable footprint**
  calls `onSetFootprint(id, <12 cells>)` for a 4×3 layer; with a footprint the row shows
  "12 tiles" and **Edit shape** calls `onEditFootprint(id)`; locked → buttons disabled.

## Definition of done — run these yourself and fix failures before finishing

```
npx tsc --noEmit -p tsconfig.json
npx vitest run src/utils/__tests__/footprints.test.ts src/state/map/__tests__/mapLayers.test.ts src/utils/__tests__ src/components/map/three/__tests__ src/components/map/views/__tests__/ImageLayersDialog.test.tsx
npx vitest run            # full client suite, must be green
npm run check:tokens
npx vite build
```

Do not modify unrelated tests to make them pass. Do not add dependencies. Do not create
`src/proto/` or leave any `PROTO` marker in the tree.

## Final summary (required)

One paragraph on: how the reducer orders the mirror flip, the rounding and the clip in
`MAP_UPDATE_IMAGE_LAYER`; how `checkPaintExpansionNeeded` obtained the footprint tiles; whether
`update()` needed a change to rebuild only the footprint group; and any place where the prototype
was *not* followed and why. List every file created or modified.
