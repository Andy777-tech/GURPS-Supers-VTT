# FIX1: tactical scale tier — live-load migration, checkpoints, GM unlock, panel state — Phase 17b step 1

You are working in the git worktree on branch `codex/tactical-scale` (uncommitted implementation of
`docs/codex-specs/tactical-scale-SPEC.md`; that spec is NOT in this worktree — everything you need
is below). Same rules: do not commit; no `npm install`; do not touch `server/`, `shared/`, `src/net/`;
no `as any`, `@ts-ignore`, `@ts-expect-error`, no new non-null `!`; `import type` for types; logic
in reducers/utils, not components.

## Why (three independent reviewers, all reproduced by the shepherd)

The 1.6.3 → 1.6.4 rewrite (`migrateTo1_6_4` in `src/utils/dataMigrations.ts`) is registered in the
raw migration table, but **that table is only run for import envelopes** (`src/utils/exportImport.ts`
`migrateImport`) and for the old `appState`/`gmState` storage (`src/utils/storage.ts:213`). The live
campaign load path — `hydrateCampaignState` in `src/persistence/campaignStorage.ts:123`, also used by
`src/net/SyncProvider.tsx:109` and `src/components/ConnectionDialog.tsx:72` — runs only the typed
`ensure*` fixups from `src/persistence/dataMigration.ts` (`ensureAmbientWeather`, `ensureTravelGroups`,
`ensureJourneyIntegrity`, …). The house pattern is therefore **a raw migration for import parity PLUS a
typed `ensure*` fixup for the live path** (see `ensureAmbientWeather` + `migrateTo1_5_7`, tested
together in `src/persistence/__tests__/ambientWeatherMigration.test.ts`). The original spec omitted the
fixup. Consequences, all verified by executing the code:

- **P1-A** A saved campaign with `scaleMilesPerTile: 50` hydrates with `scale` undefined; the first
  `isRoutableMap`/`isTacticalScale` call throws `TypeError: Cannot read properties of undefined (reading 'tier')`.
- **P1-B** Checkpoint snapshots (`checkpoints…snapshot.maps.mapsById`, restored in
  `src/state/campaignReducer.ts` around line 1134) are never visited by `migrateTo1_6_4` or the
  hydrate path; restoring a checkpoint reintroduces `scaleMilesPerTile` maps into a migrated campaign.
- **P1-C** `unlockGMData` (`src/utils/exportImport.ts:~851`) decrypts the GM payload of a locked 1.6.3
  export and only runs image-asset ingestion; `migrateImport` migrated the public half and bumped the
  envelope version, so the decrypted GM campaign still has `scaleMilesPerTile` and `mergeGM` puts it live.
- **P2-D** `src/components/map/MapPanel.tsx:~1205`: `selectedTileIds` survives switching the active map,
  so the create dialog can receive map B's id with map A's tile id; the reducer silently skips the link
  while the dialog promised one and copied B's weather.
- **P2-E** `src/components/map/MapPanel.tsx:~1056`: with the travel wizard open, switching to a tactical
  map sets `travelMode` to `'none'` and hides the wizard but leaves `showTravelWizard` true — the
  terrain palette stays hidden, drag painting stays disabled, and the hidden wizard's Close is unreachable.

## Deliverables

### 1. Typed fixup — `src/persistence/dataMigration.ts`, `src/persistence/campaignStorage.ts`

- `export function ensureMapScale(state: CampaignState): CampaignState` in the style of
  `ensureAmbientWeather`: for every map in `state.maps.mapsById` **and** every map inside every
  checkpoint snapshot (find the exact checkpoint shape from the checkpoint types and the restore case in
  `campaignReducer.ts`; walk whatever nesting holds `maps.mapsById`), if the map lacks a valid `scale`
  rung, set `scale = legacyScaleToRung(legacy scaleMilesPerTile ?? scale)` and drop the legacy key.
  Return the input **by reference** when nothing changed; when something changed, unchanged maps and
  unchanged checkpoints keep their references. Since `MapModel` no longer declares `scaleMilesPerTile`,
  read it through one local type `type LegacyMapRecord = Omit<MapModel, 'scale'> & { scale?: unknown; scaleMilesPerTile?: unknown }`
  and a small guard — no `as any`. Legacy key as a plain string literal with the house comment.
- Chain `ensureMapScale` **first** (innermost) in `hydrateCampaignState` so every later fixup and every
  consumer sees a valid `scale`. Check the two `freshState` chains at `campaignStorage.ts:~265/284` —
  fresh state has no maps, so they need no change unless they can contain maps.

### 2. Raw migration walks checkpoints — `src/utils/dataMigrations.ts`

- `migrateTo1_6_4` applies the same per-map rewrite to every checkpoint snapshot's `maps.mapsById`
  (same nesting you found in §1), with the same reference-identity rules (an untouched snapshot keeps its
  reference; the `changed` flag covers both live and checkpoint maps). Keep every level guarded with
  `isRecord`; a checkpoint that is not a record, or has no snapshot/maps, is left alone.

### 3. GM unlock migrates — `src/utils/exportImport.ts`

- `unlockGMData` must run the decrypted GM campaign through `migrateData(gm, <original export version>, CURRENT_SCHEMA_VERSION)`
  before asset ingestion / return, when the original version is older. `migrateImport` currently
  overwrites the envelope version; preserve the original (e.g. keep it on the import result / envelope as
  `originalSchemaVersion`, or pass it explicitly — choose the smallest honest change and say which in the
  summary). Validate the migrated GM payload the same way the public half is validated.

### 4. Panel state — `src/components/map/MapPanel.tsx`

- **D:** clear `selectedTileIds` whenever `maps.activeMapId` changes (an effect keyed on it), **and**
  compute the dialog's `selectedTileId` only from a tile that exists in the active map
  (`activeMap.tilesById[id]`), else `null`. Both, so a stale selection can neither link nor enable the box.
- **E:** when the active map is not routable (`travelMode === 'none'`), reset travel UI state in one
  effect: `setShowTravelWizard(false)` plus whatever staged vehicle/route/step state the wizard owns, so
  the palette, painting and header controls return immediately. Do not touch travel behaviour on
  overland maps.

### 5. Tests

- `src/persistence/__tests__/mapScaleFixup.test.ts` (pattern: `ambientWeatherMigration.test.ts`):
  `ensureMapScale` rewrites a legacy live map and a legacy checkpoint map; returns the same reference
  when nothing is legacy; unchanged maps keep identity when another map changes; a hydrated legacy map
  (`hydrateCampaignState` on a serialized 1.6.3 payload) has `scale: '50mi'`, no `scaleMilesPerTile`,
  and `isRoutableMap` does not throw.
- `src/utils/__tests__/mapScaleMigration.test.ts`: add a fixture with two checkpoints (one legacy, one
  already migrated); after `migrateData(fixture, '1.6.3', '1.6.4')` the legacy checkpoint's map has
  `scale` and no legacy key, the other checkpoint object is the same reference, idempotence holds.
- Reducer/integration test (extend the existing checkpoint test file, find it with `rg -l checkpoint src --glob '*.test.*'`):
  hydrate a 1.6.3 campaign containing a checkpoint, restore that checkpoint, assert the restored active map
  has a valid `scale`.
- Export/import test (extend the existing exportImport test file): a locked export produced from a 1.6.3
  fixture (set the envelope/schema version to `'1.6.3'` and give the GM map `scaleMilesPerTile: 50`),
  `importCampaign` → `unlockGMData` → the GM map has `scale: '50mi'` and no legacy key; `mergeGM` result
  passes `isRoutableMap` without throwing.
- MapPanel tests (extend `src/components/map/__tests__/MapPanel*.test.tsx`): (D) with a tile selected on
  map A, switch to map B, open New Map → the dialog's link checkbox is disabled / `linkFrom` absent on
  confirm; (E) open the travel wizard on an overland map, switch to a tactical map → the wizard is closed
  and the terrain palette is rendered.
- `src/components/map/three/__tests__/MapScene.grid.test.ts`: add a **rectangular** tactical map
  (e.g. 2 rows × 5 cols → 14 border walls, and assert the east walls sit at `x = cols`); assert the grid
  line height with `toBeCloseTo(tileHeight + 0.012, 6)`; the "no border / no grid on overland" cases cover
  `'12mi'`, `'50mi'` and `'457mi'`.

## Definition of done — run these yourself and fix failures before finishing

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run src/persistence src/utils src/state src/components/map src/__tests__
npx vitest run
npm run check:tokens
npx vite build
grep -rn "scaleMilesPerTile" src --include='*.ts' --include='*.tsx'   # migration, fixup, and legacy test fixtures only
```

## Final summary (required)

One paragraph: the checkpoint nesting you found and walked; how the original export version reaches
`unlockGMData`; the exact hydrate-chain order after your change; anything you could not do as written
and what you did instead. Then the actual test totals from the full run.
