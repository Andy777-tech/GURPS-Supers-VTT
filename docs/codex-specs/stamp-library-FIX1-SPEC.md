# Stamp library — fix round 1 (Phase 17a step 5)

You are working in a git worktree on branch `codex/stamp-library` (GURPS VTT: React 18 + TypeScript
strict + Vite + Vitest). The stamp library (`docs/codex-specs/stamp-library-SPEC.md`, read it for
context) was implemented in a previous round; the working tree holds that uncommitted work. Two
independent reviewers reproduced the defects below against this tree. Fix each one exactly as
described, add the listed tests, and do not touch anything else. Do NOT commit, do NOT run
`npm install`, do NOT modify `node_modules`, `server/`, `shared/`, `src/net/`. No `as any`,
no `@ts-ignore` / `@ts-expect-error`, no new dependencies, no raw Tailwind palette classes (the
`npm run check:tokens` gate). Business logic stays in reducers/utils, not components.

## Defects (all reproduced — fix every one)

### D1. Versioned import broken: no `1.6.2:1.6.3` migration handler  (P1)
`src/utils/schemaVersioning.ts` now has `CURRENT_SCHEMA_VERSION = '1.6.3'`, but the handler
registry in `src/utils/dataMigrations.ts` (~line 71, `'1.6.1:1.6.2': migrateTo1_6_2`) has no
`'1.6.2:1.6.3'` entry, so `importFile({ schemaVersion: '1.6.2', ... })` in
`src/utils/exportImport.ts` fails with `No migration handler found for 1.6.2:1.6.3`. Every older
export fails the same way at the last hop.
Fix: add `migrateTo1_6_3` (identity, documented like `migrateTo1_6_2`: "map stamp fields are
optional") and register `'1.6.2:1.6.3': migrateTo1_6_3`.
Test (in `src/utils/__tests__/exportImport.test.ts`, next to the existing envelope tests around
line 300 — reuse their envelope builder): import a valid envelope whose `schemaVersion` is
`'1.6.2'` and assert `ok === true` and that the imported campaign contents are preserved. This
test must fail before your fix and pass after; run it both ways.

### D2. `MAP_UPDATE_STAMP` overwrites protected fields  (P1)
`src/state/map/mapReducer.ts` `case MAP_UPDATE_STAMP` does `Object.assign(stamp, changes)`. A
wider object (e.g. `{ ...stamp, name: 'Renamed', id: 'other', width: 99, assetId: 'missing' }`)
is structurally assignable to `Partial<Pick<MapStamp, 'name' | 'category' | 'placement'>>`
without a cast, and the reducer then corrupts `id`/`width`/`height`/`assetId`; a later
`pruneUnreferencedAssets` deletes the real asset.
Fix: copy only `name`, `category`, `placement` (each only when defined). Test in
`src/state/map/__tests__/mapStamps.test.ts`: dispatch an update whose `changes` object carries
`id`, `width`, `height`, `footprint`, `assetId` in addition to `name`; assert `name` changed and
every other field is unchanged (compare the whole stamp with `toEqual`, not `toMatchObject`).

### D3. Starting "Draw box" (or Esc) silently discards a pending file import / slice  (P2)
`src/components/map/MapPanel.tsx`: `cancelStampTools` bumps `stampScope`, and `startStampDrag`
calls `cancelStampTools(false)`. `handleStampImport` and the slice branch of
`handleAlignBoxComplete` bail when the scope moved, so: import `Room.png`, click "Draw box"
while `importImage` is pending, resolve → the asset is stored but no stamp is added and no error
is shown (orphan asset).
Fix: separate the two concerns. Keep ONE ref, rename it `stampSessionScope`, and bump it ONLY
on active-map change, GM-mode change, and unmount (the existing effects). `cancelStampTools`
must not bump it. Pending imports/slices check `stampSessionScope` only.
Tests in `src/components/map/__tests__/MapPanel.stamps.test.tsx`: (a) with `importImage` mocked
to a deferred promise, start an import, click "Draw box" while pending, resolve → the stamp IS
added and measure mode is active; (b) start an import, then change GM mode off (or switch the
active map) before resolving → the stamp is NOT added.

### D4. Global Esc handler fires in the wrong contexts  (P2)
`MapPanel.tsx` (~line 97) adds a `keydown` listener that calls `cancelStampTools()`
unconditionally. Esc while typing in the "Stamp name" / "Stamp category" inputs, or while the
align drag or footprint editing is active (each has its own Esc handler), clears a retained
measure box and disarms placement.
Fix: ignore the event when `event.target` is an `HTMLInputElement`, `HTMLTextAreaElement`,
`HTMLSelectElement` or `isContentEditable`, and when `aligningLayerId` or
`editingFootprintLayerId` is set. Otherwise behave as now (spec decision 4: Esc clears the
retained box and cancels measure/slice/armed placement).
Test: with a retained measure box and focus inside the "Stamp name" input, press Esc → the
box is still shown in the panel ("W × H tiles" text still present); press Esc with focus on
`document.body` → the box is cleared.

### D5. Measure outline is hidden under image overlays  (P2)
`src/components/map/three/MapScene.ts` `buildMeasureBox`: the outline
`MeshBasicMaterial({ color, depthWrite: false, side })` is opaque, so three.js draws it in the
opaque pass BEFORE every transparent image plane; overlay images (`depthTest: false`) then
paint over it regardless of `renderOrder = 2001`. The fill (transparent, renderOrder 2000) is
fine.
Fix: make the outline material `transparent: true, opacity: 1` (and keep `depthWrite: false`)
so it is sorted into the transparent pass by renderOrder, above the overlays (1000 + index).
Test in `src/components/map/three/__tests__/MapScene.measure.test.ts`: every mesh in the
`measureBox` group has `material.transparent === true`, and its `renderOrder` is greater than
the `renderOrder` of every mesh in the image-layer group when the fixture has an overlay
image layer covering the box. Also add a disposal assertion: after the box is cleared
(`measureBox: null`), the fill and outline materials' `dispose` was called (spy on them).

### D6. `checkPaintExpansionNeeded` change regresses ordinary painting  (spec deviation)
`src/utils/mapUtils.ts`: the previous round replaced the on-grid `indexFootprints(map).byTile`
scan with a loop over ALL footprint cells of every image layer including cells beyond the grid.
Reproduced: a 9×9 map with an existing 2×2 footprint layer anchored at x = −5 (off-grid), paint
the centre tile → the map becomes 16×9 and the layer's x jumps to 2 (baseline b9d8b1d: 9×9,
untouched). A layer nudged far off-grid makes every later paint stroke expand unboundedly.
Fix: restore the baseline body of `checkPaintExpansionNeeded` exactly (`git diff HEAD --
src/utils/mapUtils.ts` shows it; re-add the `indexFootprints` import), then add an OPTIONAL
second parameter `extraCells?: Iterable<{ row: number; col: number }>` that is folded into the
same min/max bounding box, and thread it through
`expandMapIfNeededForPaint(map, extraCells?)`. Paint callers pass nothing. In
`MAP_PLACE_STAMP` pass the placed layer's cells: its footprint cells
(`round(x)+dx`, `round(y)+dy`) when it has a footprint, else the cells of its tile rectangle
(`floor(x)..ceil(x+width)-1` × same for y) — so the map grows to hold the stamp but never
because of some unrelated pre-existing layer.
Tests: (a) in `src/utils/__tests__/mapUtils*.test.ts` (find the existing paint-expansion test
file) pin the regression above: 9×9 map, off-grid footprint layer at x = −5, paint the centre
→ dimensions unchanged and the layer's x unchanged; (b) in `mapStamps.test.ts` place a stamp at
`{ col: 0, row: 0 }` on a map whose painted area is in the centre → the map gained rows on top
and columns on the left, the new layer's `x`/`y` equal the added left/top counts, and every
pre-existing layer's x/y shifted by the same amounts; (c) placing a stamp beside an existing
layer keeps that layer (assert `imageLayers.length === 2`).

### D7. Slice of a box partially overlapping the layer stretches pixels
`src/utils/stamps.ts` `stampFromSlice` uses the full `box.width/height`, but
`layerPixelRect` crops only the intersection, so the cropped pixels are stretched over the whole
box when placed.
Fix: add `clipMeasureBoxToLayer(layer: Pick<MapImageLayer,'x'|'y'|'width'|'height'>, box:
MeasureBox): MeasureBox | null` in `stamps.ts` — integer tile intersection of the box with the
layer's tile rectangle (`floor(layer.x)`, `floor(layer.y)`, `ceil(layer.x+layer.width)`,
`ceil(layer.y+layer.height)`), `null` when empty. In `handleAlignBoxComplete`'s slice branch,
clip the snapped box with it first; if null, set the existing "does not intersect" error;
otherwise pass the clipped box to BOTH `sliceLayerImage` and `stampFromSlice`.
Tests in `src/utils/__tests__/stamps.test.ts`: layer at (2,2) 4×3, box {col 4,row 1,w 4,h 4} →
{col 4,row 2,w 2,h 3}; fully inside → unchanged; disjoint → null; fractional layer (2.5,1.5,
4.5,3.5) with box {3,2,2,2} → unchanged.

## Minor (fix directly)

- M1. `MapPanel.tsx` `onToggleStamps` (header "Stamps" button): when it closes the panel, also
  call `cancelStampTools()` like the panel's own close button does.
- M2. `handleAlignBoxComplete` measure branch: a sub-minimum drag (`snapMeasureBox` → null)
  must leave a previously retained box in place (do not `setMeasureBox(null)`); the slice
  branch must not clear an unrelated retained measure box (remove its `setMeasureBox(null)`).
- M3. `StampLibraryPanel.tsx`: replace `event.target.value as StampCategory` with a lookup
  against `STAMP_CATEGORIES` (ignore unknown values).

## Test gaps found by mutation testing (add all; each must fail against the named mutant)

In `src/state/map/__tests__/mapStamps.test.ts`:
- add stamp B beside A → both present; remove A → B remains.
- elevation lookup at a NON-diagonal anchor `{col:2,row:3}` with `elevationOverride` 4 there and
  2 at `{col:3,row:2}` → placed layer elevation 4; override `0` on a tile whose terrain elevation
  is 2 → elevation 0 (pins `??` vs `||`).
- placement at rotation 270 → layer `rotation === 270` (not `% 180`).

In `src/utils/__tests__/stamps.test.ts`:
- `placeStamp` and `stampFromLayer` with a PNG **overlay** source keep `mime: 'image/png'` and
  `placement: 'overlay'`.
- `placeStamp` at rotation 0 keeps an explicit notched footprint (not the full rectangle).
- `filterStamps` with `onlyFitting: false` on a non-fitting stamp returns rotation 0.
- `layerPixelRect`: image 800×300 on a 4×3 layer (different px/tile per axis), box clipped at
  the right AND bottom edges → sw/sh computed with the per-axis scale (state exact numbers);
  a fractional layer (2.5,1.5,4.5,3.5), image 900×700, box {3,2,2,2} → {100,100,400,400}.
- `stampFromImage`: width 3.6 → 4; width 1 with aspect 0.1 → height 1.
- `stampFromSlice` 4×2 → footprint has exactly 8 cells.

In `src/assets/__tests__/sliceLayerImage.test.ts`: assert the first `drawImage` call receives the
source image at `(-naturalWidth/2, -naturalHeight/2)` and the second receives the transformed
canvas with the `layerPixelRect` source rectangle (a blank slice must fail the test).

In `MapPanel.stamps.test.tsx`: arm a stamp while terrain PAINT mode is active, then fire the tile
pointer-down/up sequence the paint path uses → exactly one `mapPlaceStamp` and no terrain
mutation (`mapSetTileTerrain` / paint action not dispatched).

## Out of scope (do not change)
Measure/slice always use the map's default floor elevation (spec §6) — known limitation,
tracked separately. The elevation helper lives in `src/utils/lineOfSight.ts` — keep it.

## Definition of done — run these yourself and fix failures before finishing
```
npx tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:tokens
npx vite build
```
All four must exit 0. Finish with one paragraph: which files changed, how you separated the
session scope from tool cancellation (D3), and how placement expansion now differs from paint
expansion (D6). Report the total number of vitest files/tests passing.
