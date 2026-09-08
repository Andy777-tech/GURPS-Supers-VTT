# DISPATCH: persistent map-owned tokens — Phase 17b step 2

## Task and boundaries

Implement ROADMAP.md Phase 17b ordered slice **step 2**, implementing decisions 6,
7 (footprint storage and rendering), and 15 (commit-on-drop). The prototype gate
already passed. Work in `/home/arlavale/Meta/projects/gurps-calculator`, branch
`codex/map-owned-tokens`. Do not commit or switch branches. You own implementation,
related tests, and the roadmap update for this slice. You are not alone in this
checkout: preserve existing untracked `.agents/` and `AGENTS.md`, this sealed spec,
and others' edits. Do not modify the provenance ledger or run logs.

Read the vtt-resume skill before code changes; use graphify queries before raw
source surveys and explain high-blast-radius stores/reducers before changing them.
This is the delegated implementation session: implement directly, without
recursively delegating the build. No new design session is necessary; the roadmap
decisions below are settled. Follow existing strict TypeScript, Immer domain
reducers, thin UI routers/views, and semantic theme tokens. No new dependencies,
`npm install`, `as any`, suppression comments, or new bridge contexts.

Maps currently own terrain and markers; combat participants own optional square
positions misleadingly named q/r. Tokens should exist before, during, and after
combat, with combat participants pointing to the same tokens. This makes the
tactical map useful for staging encounters and preserves the scene after a fight.

**Out of scope:** movement budgets and 1-2-1 enforcement, new reach/range/facing
overlays, multi-floor movement or removal of CombatState.mapId, network protocol
redesign, hex coordinates, roof/cutaway behavior, and unrelated refactoring.
Preserve current movement accounting until step 3. Keep current non-map encounter
creation usable. Do not force every combat participant to have a placed token.

## Required behavior

1. **Canonical domain tokens.** Add `MapModel.tokens`, keyed by stable token id,
   with each token carrying id, `{ col, row }` cell position, facing 0–7, footprint,
   label, and optional link to a campaign character or combat NPC library entry.
   Reuse the existing 17a `FootprintCell`/footprint helpers; default is one cell at
   offset zero. Use existing character/library identifier conventions
   (`partyCharacterId` refers to campaign entities.characters; `libraryId` is an
   NPC template, not a unique NPC instance). Multiple tokens may use one NPC
   template. A token id identifies the placed instance. Distinguish the domain
   token from the renderer's existing presentation-only MapToken interface.
2. **Participant references.** Participants hold an optional token reference
   (map id plus token id is preferred for unambiguous future map support). Remove
   participant-owned canonical position and facing if facing is currently owned
   there. Spatial consumers resolve through a shared selector/helper. Keep
   MovementRecord and maneuver bookkeeping on the participant. Rename coordinate
   fields q/r to col/row in movement records and all affected consumers/fixtures.
   Archived combat records must remain readable; migration must not silently
   overwrite live token positions using historical combat entries.
3. **Map authoring.** On tactical maps, the GM can place an unlinked labeled
   token or a token linked to a campaign character/NPC template; select, edit
   label/link/facing/footprint size, and remove it. A small extracted token
   editor/view is preferable to growing MapPanel. Offer rectangular width/height
   controls generating the shared footprint offsets; safely preserve supported
   existing footprint shapes. Show the occupied cells, not just an anchor icon.
   Validate finite integer coordinates, facing, and footprint contents in domain
   logic; reject placements/edits whose footprint falls outside map tiles.
   Keep existing group/vehicle icons and overland travel behavior intact.
4. **Combat lifecycle.** Provide a clear start-combat-from-map path through the
   existing encounter setup. Linked tokens populate combat participants using
   current participant factories and point back to those exact tokens. Unlinked
   decorative tokens stay on the map. Handle multiple NPC instances sharing a
   template independently. Starting another combat must not duplicate existing
   tokens. Existing encounter creation can attach/place participants on the
   selected combat map without destroying its existing token collection.
   Ending/archiving/resetting combat and removing a participant must leave its
   map token standing. Token deletion and map deletion must leave no crashing
   dangling-reference consumers; clear or safely resolve references consistently.
5. **Move once on drop.** Drag preview is transient renderer/component state;
   pointer moves must not dispatch persisted state changes. A valid changed drop
   emits one domain action that updates token position and, during combat,
   participant movement bookkeeping atomically. Cancellation, unchanged drops,
   malformed payloads, and invalid footprint destinations must not change state.
   Dragging any occupied footprint cell should move the selected token without
   jumping its anchor to the clicked interior cell. Apply existing role rules
   to edit/move/start controls; do not add player authority beyond current combat
   movement permissions. Tests must establish zero persisted updates before drop
   and exactly one on a valid drop. Preserve behavior on touch/cancel paths.
6. **Existing integrations remain coherent.** Combat movement undo/redo must
   restore the canonical map token and participant bookkeeping together; history
   currently snapshots combat alone (`useCombatHistory.ts`, `combatActions.ts`).
   Map expansion at the top/left (`expandMap` in mapUtils.ts) must translate token
   anchors and affected movement/history coordinates consistently with terrain.
   Combat-only import (`useCombatExport.ts`) must safely handle absent foreign
   maps/tokens and never move an unrelated local token by an accidental id match.
   Both `useCombatSession.ts` and the still-consumed `CombatContext.tsx` contain
   movement/LOS code: update both, preferably through shared helpers. Honor
   `combatViewFilter.ts` and current hidden-NPC rules in standalone rendering as
   well as combat rendering; the map tab must not expose hidden combat tokens.

## Storage and migration — mandatory coverage

Bump schema from 1.6.4 to **1.6.5**, with a real raw-data rewrite, plus the typed
hydration fixup used by normal local loading. Read the preceding scale migration
and FIX1 spec to understand why both exist. Cover all of these entry paths:

- normal persisted campaign hydration, including browser/local campaign storage;
- full JSON export/import and validation;
- GM unlock of protected export data, using its original schema version;
- checkpoint snapshots and checkpoint restore;
- active combat and historical/archived combat records where present.

Initialize absent collections on every map, including non-tactical maps. For a
legacy positioned participant with an existing combat map, create/reuse a
deterministic token, copy label/link/facing/position, default footprint, and
replace the position with a token reference. Do not use random ids during
migration, and do not merge NPC instances by their shared libraryId. Rewrite
MovementRecord coordinate data. Repeating migration must preserve ids and token
counts and return unchanged data by reference where the house migration pattern
requires it. Existing valid new-format tokens/references take precedence.

Legacy position data with a missing/invalid map, malformed coordinates, or an
unresolvable token must not crash loading or create off-grid tokens. Preserve
recoverable historical information in a clearly isolated legacy/archive form if
necessary; do not invent a live map or silently move valid existing tokens.
Document the exact chosen fallback and test it. Unknown extension fields survive
raw migration. A GM unlock must never replace migrated live maps with legacy maps.

## Starting anchors (confirm exact current names)

- `src/types/map.ts`: MapModel; `src/types/combatTracker.ts`: Participant and
  MovementRecord. `src/utils/footprints.ts`: defaultFootprint and shared helpers.
- `src/state/map/mapActions.ts`, `mapReducer.ts`, and map selectors: token CRUD.
  Keep cross-domain atomic work in the existing campaign reducer delegation style.
- `src/components/combat/EncounterSetup.tsx`: existing saveCombatActive path
  initializes a session. The old campaignReducer startCombat helper only sets
  legacy encounter/checkpoint flags; changing it alone is insufficient.
- `src/components/combat/CombatMapPanel.tsx`: participant spatial access and
  drag/drop callbacks; replace anchor-only occupant resolution with footprint-aware
  token resolution. Update every affected combat consumer, not just this panel.
- `src/components/map/MapPanel.tsx`, `views/Map3DView.tsx`,
  `three/MapScene.ts`: standalone authoring and render/drag plumbing. MapScene
  already has onTokenDragStart/onTokenDrop and buildTokens. Preserve existing
  overland projections from `src/utils/mapTokens.ts`.
- `src/utils/dataMigrations.ts`, `schemaVersioning.ts`, `exportImport.ts`,
  `src/persistence/dataMigration.ts`, `campaignStorage.ts`: migration wiring.
- `docs/codex-specs/tactical-scale-FIX1-SPEC.md`: hydration, checkpoint, GM unlock
  regression lessons. `ROADMAP.md:460-499`: settled decisions and ordered slice.

## Definition of done and self-verification

Add meaningful regression tests for token CRUD/validation, rectangular footprint
occupancy and bounds, ordinary token placement and dragging, persisted drop event
count/cancel behavior, linked-token combat creation (including duplicate NPC
templates), end-combat persistence, missing/deleted token safety, and all migration
entry points above (old/new/malformed/idempotent/checkpoint inputs). Tests should
exercise public reducers/hydration/import paths rather than only private helpers.
Update existing fixtures for required fields and coordinate changes. Avoid tests
that merely repeat constants or mirror the implementation.

Run `npx tsc --noEmit -p tsconfig.json`, relevant Vitest files (combat integration,
map reducers/components, migration/persistence/import), `npm run check:tokens`,
and `npx vite build`. This is native Linux, so the obsolete Cowork-VM full-suite
OOM restriction does not apply; run the full suite if practical. Do not claim a
default-config test pass if you used a workaround config; record it explicitly.
Baseline: combatIntegration 12/12, tsc passes, Vite largest chunks 605.14 kB and
599.07 kB with an existing >500 kB warning. Fix failures caused by this change.

Update ROADMAP step 2 with actual completed behavior and point next to step 3;
do not claim independent shepherd review has happened. Refresh graphify after
changes. Final answer: changed files, architecture and migration fallback choices,
test commands/counts and limitations, and any remaining defects. Do not commit.
