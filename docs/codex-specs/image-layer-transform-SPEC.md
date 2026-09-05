# DISPATCH: image layer rotate / mirror / lock — Phase 17a step 2

You are working in a git worktree on branch `codex/image-layer-transform` of a GURPS virtual
tabletop (React 18 + TypeScript strict + Vite + three.js; Vitest with jsdom). Do not commit. Do not
run `npm install` — `node_modules` (root and `server/`) is symlinked and complete. Do not touch
`server/`, `shared/`, or `src/net/`. Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`.
Use `import type` for type-only imports. Keep business logic out of components (reducers/utils).

## Background (why)

Map image layers (`MapImageLayer`, `src/types/map.ts` ~:200) are imported battlemap images placed
on the tile grid with `x/y` (top-left corner, tile units), `width/height` (tile units),
`placement`, `opacity`, `visible`, `gmOnly`, `elevation`, and (since step 1) `assetId`/`mime` or a
legacy `src`. The next roadmap items compose many such layers ("room stamps") on one map. None of
rotate, mirror, or lock exist today, and lock is the first thing users ask for once layers stack.
This dispatch adds all three, end to end: type, reducer, renderer, GM dialog, tests.

## Design decisions (fixed — do not revisit)

1. **Stored geometry is always the rendered footprint.** `x/y/width/height` describe the axis-aligned
   box the image occupies on the grid *after* rotation. Every existing consumer (Align 3×3 in
   `src/utils/imageAlign.ts`, Snap / Size-to-grid / Fit-map in the dialog, the map-expansion offset
   in `src/utils/mapUtils.ts` ~:350, the reducer clamps) therefore keeps working unchanged. A 90°
   step **swaps width and height in state** and recenters `x/y` so the footprint center is unchanged.
2. **`rotation`** is `0 | 90 | 180 | 270` degrees, **clockwise in grid coordinates** (x = column
   increasing to the right, y = row increasing downward). Rotating clockwise by 90° moves the image's
   top-left corner to the footprint's top-right corner.
3. **`mirrorX`** flips the image left↔right, **`mirrorY`** flips top↔bottom. Mirrors are applied in
   image space **before** rotation: rendered = rotate(rotation) ∘ mirror(mirrorX, mirrorY) ∘ image.
4. **`locked`** freezes the layer's geometry and prevents removal. Blocked while locked: `x`, `y`,
   `width`, `height`, `rotation`, `mirrorX`, `mirrorY`, `elevation`, and `MAP_REMOVE_IMAGE_LAYER`.
   Still allowed while locked: `name`, `visible`, `opacity`, `placement`, `gmOnly`, and `locked`
   itself. Lock is enforced **in the reducer** (so any future drag-move is automatically blocked) and
   mirrored in the dialog (controls disabled). Map-edge expansion (`mapUtils` offset) is not an action
   on the layer and **still moves locked layers** — that keeps them glued to the same terrain.
5. All four new fields are optional (`undefined` ≡ `0` / `false`). No persistence migration; exports
   carry them verbatim (`CampaignImportSchema.public` is `z.record(z.string(), z.unknown())`, so no
   schema change). Verify `src/assets/assetMigration.ts` preserves unknown layer fields when it
   rewrites a legacy `src` layer (it should spread the layer; fix if it doesn't).

## Deliverables

### 1. Types — `src/types/map.ts`

```ts
/** Quarter-turn rotation of an image layer, degrees clockwise in grid coordinates. */
export type ImageLayerRotation = 0 | 90 | 180 | 270;
```
On `MapImageLayer` add, with doc comments stating the decisions above:
```ts
  /** Quarter-turn rotation, clockwise in grid coords. x/y/width/height are the rotated footprint. Default 0. */
  rotation?: ImageLayerRotation;
  /** Flip left↔right in image space (applied before rotation). */
  mirrorX?: boolean;
  /** Flip top↔bottom in image space (applied before rotation). */
  mirrorY?: boolean;
  /** Geometry (x/y/width/height/rotation/mirror/elevation) and removal are frozen while true. */
  locked?: boolean;
```

### 2. Pure helpers — new `src/utils/imageLayerTransform.ts`

```ts
import type { ImageLayerRotation, MapImageLayer } from '../types/map';

export type ImageLayerGeometry = Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** Keys frozen by `locked` (see MapImageLayer.locked). */
export const LOCKED_IMAGE_LAYER_KEYS: ReadonlySet<keyof MapImageLayer>;   // x,y,width,height,rotation,mirrorX,mirrorY,elevation

/** Coerce any number to the nearest quarter turn in [0, 360). NaN/undefined → 0. */
export function normalizeRotation(value: number | undefined): ImageLayerRotation;

/**
 * Rotate one quarter turn. Swaps width/height and recenters x/y so the footprint
 * center is unchanged; values rounded to 3 decimals (same round3 as the dialog).
 * e.g. { x:2, y:1, width:4, height:3, rotation:0 } cw → { x:2.5, y:0.5, width:3, height:4, rotation:90 }
 */
export function rotateImageLayer(layer: ImageLayerGeometry, direction: 'cw' | 'ccw'): ImageLayerGeometry;

/**
 * Strip keys frozen by lock from a partial update. Returns the same object when nothing was stripped.
 * A change that sets `locked: false` still has its geometry keys stripped — unlock and edit are two steps.
 */
export function stripLockedChanges(changes: Partial<Omit<MapImageLayer, 'id'>>): Partial<Omit<MapImageLayer, 'id'>>;
```

### 3. Actions + reducer — `src/state/map/mapActions.ts`, `src/state/map/mapReducer.ts`, `src/state/campaignStore.tsx`

- New action `MAP_ROTATE_IMAGE_LAYER = 'map/rotateImageLayer'` with payload
  `{ mapId: MapId; layerId: ImageLayerId; direction: 'cw' | 'ccw' }`. Add the type to the `MapAction`
  union and the exported action-type list, following the existing image-layer actions exactly.
- Reducer:
  - `MAP_ROTATE_IMAGE_LAYER`: no-op if the layer is missing or `locked`; otherwise apply
    `rotateImageLayer` (Immer draft, assign the four geometry fields + rotation).
  - `MAP_UPDATE_IMAGE_LAYER`: if the existing layer is `locked`, apply `stripLockedChanges(changes)`
    instead of `changes`. After assignment, normalize `rotation` with `normalizeRotation` when it is
    present in the layer. Keep the existing opacity/elevation/width/height clamps.
  - `MAP_REMOVE_IMAGE_LAYER`: no-op if the layer is `locked`.
- `campaignStore.tsx`: add `mapRotateImageLayer(mapId, layerId, direction)` next to
  `mapUpdateImageLayer` / `mapRemoveImageLayer` (grep for them; match their shape).

### 4. Renderer — `src/components/map/three/MapScene.ts` `buildImageLayers` (~:810)

Each layer is a `THREE.Mesh(PlaneGeometry(1,1), MeshBasicMaterial{ side: DoubleSide })` with
`rotation.x = -Math.PI / 2`, `scale.set(width, height, 1)`, positioned at the footprint center.
Apply rotation and mirror on the **mesh transform**, not on texture UVs (the test projects geometry
vertices through `matrixWorld`):

- The plane's pre-rotation size is the *image-space* size: for rotation 90/270 that is
  `(layer.height, layer.width)`, otherwise `(layer.width, layer.height)`.
- `scale.set(imgW * (mirrorX ? -1 : 1), imgH * (mirrorY ? -1 : 1), 1)`. Negative scale is fine —
  the material is already `DoubleSide`.
- Rotate about the plane's normal by the quarter turn so that the result is **clockwise in grid
  coordinates** (world +x = column, world +z = row; the existing `rotation.x = -π/2` maps local +y to
  world −z, i.e. "up" on the map). Set the Euler explicitly (`plane.rotation.set(-Math.PI/2, 0, θ)` or
  equivalent) and work out the sign of θ from the corner table below — do not guess; the test pins it.
- Position stays the footprint center: `(layer.x + layer.width/2, <existing height formula>, layer.y + layer.height/2)`.
- Confirm the existing `update()` change detection (`oldData.map !== data.map`, ~:189) rebuilds image
  layers when only `rotation`/`mirrorX`/`mirrorY` changed (Immer produces a new map object). If it
  does not, fix the detection minimally.

**Corner table** (footprint from the stored geometry; "image TL" = source-image top-left texel =
PlaneGeometry vertex with uv (0,1); TR = uv (1,1); BL = uv (0,0); BR = uv (1,0). World coords given
as (x, z)):

| stored geometry | rotation | mirrorX | mirrorY | image TL → | image TR → | image BL → |
|---|---|---|---|---|---|---|
| x2 y1 w4 h3 | 0   | f | f | (2,1)     | (6,1)     | (2,4)     |
| x2.5 y0.5 w3 h4 | 90 | f | f | (5.5,0.5) | (5.5,4.5) | (2.5,0.5) |
| x2 y1 w4 h3 | 180 | f | f | (6,4)     | (2,4)     | (6,1)     |
| x2.5 y0.5 w3 h4 | 270 | f | f | (2.5,4.5) | (2.5,0.5) | (5.5,4.5) |
| x2 y1 w4 h3 | 0   | t | f | (6,1)     | (2,1)     | (6,4)     |
| x2 y1 w4 h3 | 0   | f | t | (2,4)     | (6,4)     | (2,1)     |
| x2.5 y0.5 w3 h4 | 90 | t | f | (5.5,4.5) | (5.5,0.5) | (2.5,4.5) |

### 5. GM dialog — `src/components/map/views/ImageLayersDialog.tsx`

- New prop on `ImageLayersDialog` and `LayerCard`: `onRotateLayer: (layerId: ImageLayerId, direction: 'cw' | 'ccw') => void`.
- Header row (next to the Eye toggle): a **lock toggle** button, `aria-label` "Lock image" / "Unlock image",
  icons `Lock` / `Unlock` from `lucide-react` (both exist in the installed 0.294), dispatching
  `onUpdateLayer(layer.id, { locked: !layer.locked })`. When locked, the Delete button is
  `disabled` with title "Unlock to delete" and must not call `onRemoveLayer`.
- New transform row (place it above the "Size to grid" row): buttons **Rotate ↺** (`RotateCcw`,
  aria-label "Rotate counter-clockwise") and **Rotate ↻** (`RotateCw`, aria-label "Rotate clockwise")
  calling `onRotateLayer`; toggle buttons **Mirror H** (`FlipHorizontal2`, aria-label "Mirror horizontally",
  `aria-pressed={!!layer.mirrorX}`) and **Mirror V** (`FlipVertical2`, "Mirror vertically",
  `aria-pressed={!!layer.mirrorY}`) calling `onUpdateLayer` with the toggled boolean. Show the current
  rotation as text (e.g. `90°`) when non-zero. Match the existing button classes in the file.
- While `locked`: disable the X / Y / Width / Height / Elev number fields (add a `disabled?: boolean`
  option to `numberField`), Align 3×3, Size to grid, Snap, Fit map, both Rotate buttons, both Mirror
  buttons, and Delete. Name, visibility, opacity, placement and GM-only stay live. Add a small
  "Locked" text badge next to the name.
- `src/components/map/MapPanel.tsx`: wire `onRotateLayer={(id, dir) => actions.mapRotateImageLayer(activeMap.id, id, dir)}`
  where the dialog is rendered (~:945), and make `setAligningLayerId` refuse a locked layer
  (defensive; the button is already disabled).

### 6. Tests (Vitest; follow the patterns of the files named)

- New `src/utils/__tests__/imageLayerTransform.test.ts`: `rotateImageLayer` cw/ccw swap + recenter
  (the example in §2 plus ccw from 0 → 270 with the same footprint); four cw turns return to the
  original geometry exactly; `normalizeRotation` for 450 → 90, -90 → 270, NaN → 0, 100 → 90;
  `stripLockedChanges` strips every key in `LOCKED_IMAGE_LAYER_KEYS`, keeps the rest, and strips
  geometry even when `locked: false` is in the same change.
- Extend `src/state/map/__tests__/mapLayers.test.ts` (it already has image-layer fixtures and the
  `MAP_*_IMAGE_LAYER` actions): locked layer — update with `{ x: 9, name: 'N' }` changes only the
  name; remove is a no-op; rotate action is a no-op; `{ locked: false }` then remove works; unlocked
  rotate action swaps width/height and recenters; update normalizes `rotation` (e.g. 450 → 90).
- Extend the `mapUtils` tests (find the file that covers `expandMapIfNeeded` / `expandMap`; if there is
  none, add `src/utils/__tests__/mapUtils.imageLayers.test.ts`): a `locked: true` layer is offset when
  rows/cols are prepended, identically to an unlocked one.
- New `src/components/map/three/__tests__/MapScene.transform.test.ts`, modelled on
  `MapScene.assets.test.ts` (same `vi.mock('three', …)` WebGLRenderer stub, same `setup()` shape, same
  `requestAnimationFrame` spies). Use a layer with an inline `src` (the `src` path assigns the texture
  synchronously) and mock `THREE.TextureLoader.prototype.load` to return a `new THREE.Texture()`. After
  `scene.update(frame)`, locate the image mesh (spy on `THREE.Scene.prototype.add` to capture the
  group, or traverse `scene['scene']`), call `mesh.updateMatrixWorld(true)`, read the geometry's
  `position` and `uv` attributes, project each vertex with `applyMatrix4(mesh.matrixWorld)`, and assert
  the (x, z) of the uv (0,1), (1,1), (0,0) vertices against **every row of the corner table in §4**
  (`toBeCloseTo`, 3 digits). Also assert that a second `update()` with a map whose only difference is
  `rotation: 90` (and swapped geometry) yields different projected corners (rebuild path works).
- Extend `src/components/map/views/__tests__/ImageLayersDialog.test.tsx`: locked layer → Delete is
  disabled and `onRemoveLayer` is not called on click, the Width input is disabled, Align 3×3 is
  disabled; clicking "Unlock image" calls `onUpdateLayer(id, { locked: false })`; unlocked layer →
  clicking "Rotate clockwise" calls `onRotateLayer(id, 'cw')`, clicking "Mirror horizontally" calls
  `onUpdateLayer(id, { mirrorX: true })`.

## Definition of done — run these yourself and fix failures before finishing

```
npx tsc --noEmit -p tsconfig.json
npx vitest run src/utils/__tests__/imageLayerTransform.test.ts src/state/map/__tests__/mapLayers.test.ts src/components/map/three/__tests__ src/components/map/views/__tests__/ImageLayersDialog.test.tsx
npx vitest run            # full client suite, ~15 s, must be green
npm run check:tokens
npx vite build
```

Do not modify unrelated tests to make them pass. Do not add dependencies.

## Final summary (required)

One paragraph on design decisions, in particular: the exact Euler/sign used for the quarter-turn
and how you verified it against the corner table; whether the `update()` change detection needed a
change; whether `assetMigration.ts` needed a fix to preserve the new fields. List every file created
or modified.
