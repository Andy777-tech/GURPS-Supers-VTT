# Stamp library — fix round 2: measure/slice drag plane on raised floors (Phase 17a step 5, F1)

You are working in a git worktree on branch `codex/stamp-library` (GURPS VTT: React 18 + TypeScript
strict + Vite + Vitest). The stamp library (`docs/codex-specs/stamp-library-SPEC.md`; its
"Follow-ups → F1" section is the design decision this round implements) is already committed on
this branch. This is a small, self-contained fix. Do NOT commit, do NOT run `npm install`, do NOT
modify `node_modules`, `server/`, `shared/`, `src/net/`. No `as any`, no `@ts-ignore` /
`@ts-expect-error`, no new dependencies, no raw Tailwind palette classes (the `npm run check:tokens`
gate). Touch only the files listed under "Files"; `git status` at the end must show nothing else.

## Background

The map is rendered by three.js with a perspective camera only (`src/components/map/three/MapScene.ts`,
`CAMERA_FOV`; there is no orthographic toggle). The image-align drag, the stamp **measure** drag and
the **slice-from-layer** drag all share one channel: `MapPanel` passes `alignMode={{ elevation }}`
to `Map3DView`, which forwards it to `MapScene.update()`. `MapScene.pickGroundPoint()` intersects the
pointer ray with a horizontal plane at `alignPlaneHeight()`, which is derived from
`alignMode.elevation` (`Math.max(elevation * TILE_LIFT, BASE_PLATE) + 0.02`, the same floor formula
as image layers and `tileHeight()`).

## The failing case (reproduced by independent review)

`MapPanel.tsx` (~line 992) wires the measure and slice drags with
`{ elevation: DEFAULT_TERRAIN_ELEVATION }` (`DEFAULT_TERRAIN_ELEVATION = 1`, `src/constants/map.ts`).
On any raised floor the ray hits the default-floor plane at the wrong x/z because of perspective
parallax. Reproduced: with every tile at effective elevation 6, a drag whose two pointer positions
visually sit on the elevation-6 surface over the 2×2 block `{col:3,row:3,w:2,h:2}` reaches
`onAlignBoxComplete` as a box that snaps to `{col:3,row:0,w:2,h:3}` instead. Everything downstream
uses the wrong tiles: the fit filter, the placement anchor, and the slice crop. The slice case is a
**data** bug (wrong pixels are baked into a stamp asset). `buildMeasureBox` later raises the
completed highlight to the true surface, but that does not repair the intersection that produced the
box.

## The decision (from spec Follow-ups F1 — implement exactly this)

1. **Slice-from-layer uses the sliced layer's elevation.** `MapImageLayer.elevation` exists
   (`src/types/map.ts`), so the target floor is known before the drag starts. The slice branch passes
   `{ elevation: slicingLayer.elevation }` — the same shape the align flow already uses
   (`{ elevation: aligningLayer.elevation }`).
2. **Free measure locks the plane to the tile under the pointer at pointer-down.** `MapScene` already
   has `pickWithPoint()` (raycasts the tile instanced mesh and returns the `PickEntry`) and
   `getEffectiveElevation(map, tileId)` (imported from `src/utils/lineOfSight.ts`; `tileHeight()`
   uses it). At pointer-down in measure mode, resolve that elevation **once** and use the resulting
   plane height for the whole drag (pointer-down, every move, and up). Pointer-down off the map
   (no tile hit) falls back to `alignMode.elevation` (the prop, i.e. `DEFAULT_TERRAIN_ELEVATION`).
   Structure-layer tops are NOT considered (matches the placement rule: anchor elevation =
   `elevationOverride` ?? terrain elevation).
3. **Rejected — do not implement:** per-frame raycasts against tile tops during the drag; any
   orthographic camera; any change to `buildMeasureBox`, `snapMeasureBox`, `clipMeasureBoxToLayer`,
   placement, or the align flow's behaviour.

## Implementation

### `src/components/map/three/MapScene.ts`
- Widen the frame-data field to
  `alignMode: { elevation: number; planeFromPointerTile?: boolean } | null;` and extend its doc
  comment: when `planeFromPointerTile` is true, the drag plane is locked at pointer-down to the
  effective elevation of the tile under the pointer (falling back to `elevation` when the pointer is
  off the map); otherwise the plane is always at `elevation`.
- Add `alignPlaneY: number | null` to `PointerDrag` (initialise `null`). In `onPointerDown`, when
  `alignMode` is active: if `planeFromPointerTile`, call `pickWithPoint()`; the elevation is
  `getEffectiveElevation(this.data.map, hit.entry.tileId)` when there is a hit, else
  `alignMode.elevation`. Convert with the existing floor formula and store it on the drag **before**
  `pickGroundPoint()` / `beginAlignRect()` run, so the first intersection and the preview group's
  `position.y` are both on the locked plane.
- Make the plane height explicit: `pickGroundPoint(clientX, clientY, planeY)` (or an equivalent
  private helper) with `alignPlaneHeight()` reduced to "plane height for `alignMode.elevation`" and
  a sibling for an arbitrary elevation. Every call site during a drag passes the drag's locked
  `alignPlaneY`. **Careful:** `onPointerUp` sets `this.pointerDrag = null` before it picks the
  final point — read the locked plane from the local `drag`, never from `this.pointerDrag`.
- Keep the existing guards: Esc mid-drag (alignMode becomes null) still cancels without reporting;
  `beginAlignRect`/`updateAlignRect`/`clearAlignRect` keep their shapes; nothing else in the
  pointer state machine changes (paint, token drag, orbit/pan, edge clicks untouched).

### `src/components/map/views/Map3DView.tsx`
- Widen the `alignMode` prop type to the same shape and pass it through unchanged. No HUD change.

### `src/components/map/MapPanel.tsx`
- Replace the `alignMode` expression (~line 992):
  - aligning → `{ elevation: aligningLayer.elevation }` (unchanged);
  - `measureMode === 'slice'` → `{ elevation: slicingLayer.elevation }` where `slicingLayer` is the
    active map's image layer with id `slicingLayerId` (memoise it like `aligningLayer`); if the
    layer is missing (the existing effect clears `slicingLayerId` when the layer disappears) fall
    back to `{ elevation: DEFAULT_TERRAIN_ELEVATION }` — never throw, never leave the mode armed
    with no plane;
  - `measureMode === 'measure'` → `{ elevation: DEFAULT_TERRAIN_ELEVATION, planeFromPointerTile: true }`;
  - otherwise `null`. GM gating stays exactly as it is.
- Business logic stays out of the component: nothing beyond selecting the elevation to pass.

## Tests (all must be added; each must FAIL against the pre-fix code and pass after)

Use the existing scene-test scaffolding (`MapScene.measure.test.ts` / `MapScene.edges.test.ts`:
mocked `WebGLRenderer`, `getBoundingClientRect` 800×600, `getContext` → null, canvas
`MouseEvent`s of type `pointerdown` / `pointermove` / `pointerup`, and
`vi.spyOn(THREE.Raycaster.prototype, 'intersectObject')` to stand in for the tile-mesh hit; the
`imageState` / `imageLayer` fixtures in `src/assets/__tests__/fixtures.ts`). The camera and the
plane intersection are real (`THREE.Ray.prototype.intersectPlane` is not mocked). Put the scene
tests in a new `describe('MapScene align drag plane', …)` block in
`src/components/map/three/__tests__/MapScene.measure.test.ts`.

To obtain the scene's camera without reaching into private fields, spy on
`THREE.Raycaster.prototype.setFromCamera` and capture its second argument during a preliminary
`pointermove` (hover); then compute client coordinates for a world point by
`point.project(camera)` → `clientX = (ndc.x + 1) / 2 * 800`, `clientY = (1 - ndc.y) / 2 * 600`.

1. **Review repro (measure, raised floor).** Map from `imageState([])`; set every tile's
   `elevationOverride` to 6 (or set the terrain elevation to 6 — whichever the fixture makes
   simplest, state which). Frame `alignMode: { elevation: 1, planeFromPointerTile: true }`. Mock
   `intersectObject` to return a hit for the tile at `{row:3,col:3}` (`instanceId = 3 * map.cols + 3`)
   during pointer-down. Compute the elevation-6 plane height `y6 = Math.max(6 * 0.35, 0.06) + 0.02`
   and drive `pointerdown` at the projection of world `(3.2, y6, 3.2)`, `pointermove` and
   `pointerup` at the projection of `(4.8, y6, 4.8)`. Assert `onAlignBoxComplete` was called once
   and that its box, passed through `snapMeasureBox` (the helper `MapPanel` imports from
   `src/utils/stamps.ts`), equals `{ col: 3, row: 3, width: 2, height: 2 }`. Also assert
   `Ray.prototype.intersectPlane` (spy, call-through) received a plane whose `constant` is `-y6`
   on every call of the drag.
2. **Plane stays locked when the pointer leaves the tile mesh mid-drag.** Same setup; after
   pointer-down change the `intersectObject` mock to return `[]` for the move/up. The plane
   constant is still `-y6` on the move and up calls (no re-resolution per frame).
3. **Slice / align ignore the tile under the pointer.** Frame `alignMode: { elevation: 3 }` (no
   flag), every tile at effective elevation 6, `intersectObject` returning the `{row:3,col:3}` hit.
   Drive a drag; every `intersectPlane` call receives constant `-(Math.max(3 * 0.35, 0.06) + 0.02)`.
4. **Measure pointer-down off the map.** `alignMode: { elevation: 1, planeFromPointerTile: true }`,
   `intersectObject` returning `[]` throughout. The drag does not throw, `onAlignBoxComplete` is
   called once, and the plane constant on every call is `-(Math.max(1 * 0.35, 0.06) + 0.02)`.
5. **MapPanel wiring** (`src/components/map/__tests__/MapPanel.stamps.test.tsx`, existing
   scaffolding): (a) clicking "Draw box" yields `view.alignMode` equal to
   `{ elevation: 1, planeFromPointerTile: true }` — update the existing `toEqual({ elevation: 1 })`
   assertions on the measure path accordingly; (b) with a layer whose `elevation` is 3, "Slice from
   layer" yields `{ elevation: 3 }` exactly (no flag); (c) "Align 3×3" still yields
   `{ elevation: <layer elevation> }` with no flag (the existing align assertions must remain as they
   are).
6. Existing `MapScene.transform.test.ts`, `MapScene.edges.test.ts`, `MapScene.footprints.test.ts`,
   `MapScene.assets.test.ts` and the rest of `MapScene.measure.test.ts` stay green unchanged.

For tests 1–4, confirm the failure mode by temporarily hard-coding the pre-fix plane
(`alignMode.elevation` only) and running the file; restore the fix; report which assertion failed
for each.

## Files
Modify: `src/components/map/three/MapScene.ts`, `src/components/map/views/Map3DView.tsx`,
`src/components/map/MapPanel.tsx`, `src/components/map/three/__tests__/MapScene.measure.test.ts`,
`src/components/map/__tests__/MapPanel.stamps.test.tsx`. Nothing else.

## Definition of done — run these yourself and fix failures before finishing
```
npx tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:tokens
npx vite build
```
All four must exit 0. (If the sandbox denies the server socket-integration test with EPERM, exclude
that one file only, say so, and run everything else.) Finish with one paragraph: which files changed,
how the locked plane is threaded from pointer-down through move and up (including how `onPointerUp`
reads it after `pointerDrag` is nulled), what each of tests 1–4 reported when run against the
pre-fix plane, and the total number of vitest files/tests passing.
