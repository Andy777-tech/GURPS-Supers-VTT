# DISPATCH: map-owned tokens — independent review corrections

Continue on `codex/map-owned-tokens` after completing `map-tokens-SPEC.md`.
Do not commit, switch branches, install dependencies, or edit the sealed original
spec/provenance ledger. You are not alone: preserve other edits and untracked
AGENTS/skill files. Own only fixes and regression tests for the findings below.
Use the same VTT architectural conventions and verification gates as the original.

These findings were reproduced independently against the in-progress first run;
recheck them against its final changes before patching. Details and executable
in-memory source snippets are in `/tmp/map-tokens-state-review.md`.

**Final first-run review update:** Findings 1 and 2 below are now accepted as
fixed. Reviewer used actual current createdToken history metadata to confirm
initial placement undo removes the token and redo restores the same identity.
Finding 7 is also fixed: editing state now suppresses painting. Preserve these
fixes; verify their existing tests rather than reworking them. Finding 5's
inaccessibility is mitigated by selected-token preference; still restore the
previous non-stacking behavior as specified below rather than silently changing
movement semantics in this ownership slice. Findings 3, 4, 6, 8, 9 remain.

## Confirmed findings

1. **Malformed loaded tokens crash map expansion.** `mapTokenMigration.ts` only
   ensures that tokens is a record; `{ tokens: { broken: null } }` survives
   hydration, then `expandMap` dereferences the null token's position. Validate
   existing token entries at hydration/import boundaries and isolate recoverable
   invalid raw data following the migration's fallback convention. All consumers
   must safely handle the resulting canonical data. Test null/non-record tokens,
   invalid positions/facing/footprints, hydration idempotence, and expansion after
   loading malformed data. Merely hiding the token in the renderer is insufficient.
2. **Undoing first placement leaves an orphan token.** GM placement of a previously
   unplaced participant creates a new token, but local combat undo restores an
   unplaced participant and leaves the created map token standing because its
   history has no fromTileId. Distinguish newly created tokens from moves of
   existing tokens. Undo creation removes only that created token; redo recreates
   it with the same identity/link/geometry. End combat/removing participants still
   leaves standing tokens as specified. Cover local and global undo/redo, subsequent
   placement, and duplicate NPC-template instances through real hooks/reducers.
3. **Unrelated combat undo restores stale pre-expansion movement coordinates.**
   Sequence: move a token, edit HP, expand left/top, then undo the HP edit with
   reveal state present. History replay restores the prior movement's saved combat
   snapshot, whose coordinates predate expansion. useCombatHistory currently
   rebases only the branch where the current action carries tokenMove. Rebase
   movement data against current map/stable tile identities for every reconstructed
   combat saved by undo/redo, including reveal/checkpoint replay and unrelated
   actions. Do not overwrite live token placement with unrelated history snapshots.
   Add real hook/provider tests for move → HP edit → repeated top/left expansion →
   undo/redo, with and without reveal state.

Also verify the related maneuver-reset path: changing a maneuver after movement
can restore token position while recording only decision/log actions. Undo/redo
must restore both token position and the corresponding movement decision/log.
  Review both useCombatSession and CombatContext rather than fixing only one path.

## UI/lifecycle review corrections

See `/tmp/map-tokens-ui-review.md` for independent repros and anchors (the reviewer
is preparing it). Recheck final first-run versions before applying corrections.

4. **Editor obscures existing header controls.** The absolute top/right token
   editor is positioned relative to the wrapper containing the map header, so it
   covers Move to Map, Map images, Stamps and settings. The parent confirmed this
   at the browser's normal 1265×712 viewport. Place the editor below the header
   within the map body or use an explicit collapsible panel. Existing controls and
   meaningful canvas space must remain reachable at ordinary desktop sizes.
5. **Overlapping tokens become unreachable.** CombatMapPanel's previous occupied
   destination guard was removed, but tokenReducer permits overlap and tokenAtCell
   always returns the first token. Restore the prior non-stacking rule, checking
   every occupied footprint cell for placement, movement, and footprint resize,
   excluding the token itself. Reject atomically without spending movement or
   creating history. Do not treat legacy overland group/vehicle presentation icons
   as tactical combat occupancy. Test interior-cell collisions and legal adjacency.
6. **Encounter map switch strands referenced tokens.** Starting from map A then
   selecting map B keeps participant references on A; B displays them as unplaced
   but rejects GM placement due to the different-map reference. Make map choice
   and roster references coherent before starting. Preserve tokens on A. Either
   repopulate the map-derived roster from B with a clear UI or detach the carried
   participant references for placement on B; preserve deliberate non-map roster
   entries and avoid duplicate template instances. Also cover the active-combat
   map picker while this step retains single-map combat semantics.
7. **Paint mode intercepts token dragging.** Placing a token after painting only
   temporarily disables paint while placing=true; after drop, paint mode resumes
   and pointerdown on the new token paints instead of selecting/dragging. Enter
   the appropriate view/token interaction mode explicitly for token authoring,
   and make Escape/cancel behavior predictable without breaking terrain tools.
8. **Hidden tokens leak after combat ends.** buildTacticalTokens hides unrevealed
   NPCs only by consulting active participants. Once activeSession is cleared or
   the participant is removed, their standing token immediately exposes its real
   label/position to players (repro label: Secret boss). Retain the applicable
   visibility/reveal policy with persistent tokens or resolve retained reveal
   metadata consistently; do not silently promote hidden NPCs to visible because
   combat ended. Preserve GM access and current partially revealed label behavior.
   Test end-combat, participant removal, reload, and both standalone/combat views.
9. **Start-from-map loses its payload on a fresh lazy mount.** Parent browser
   reproduction: reload on Map with a persisted character-linked token; click the
   map's Start combat button; Combat/Encounter Setup opens with Combat map = No map
   and an empty roster. Reviewer reproduced the cause with React/jsdom:
   CombatTab's view starts as library and is latched to setup in a parent effect;
   EncounterSetup clears pendingIntent in its child effect, causing synchronous
   external-store notification before the parent latch. Setup unmounts/remounts
   and loses its local staging state (two mounts, one unmount). Preserve the
   requested map/roster until encounter setup
   consumes it, through the existing store/navigation mechanism or another robust
   owned state path. Do not depend on a one-shot window event reaching a component
   that has not mounted yet. Add a lazy-mount/navigation regression and cover
   returning from other modules as well as an already-mounted combat module.

## Verification

Run focused regressions, `npx tsc --noEmit -p tsconfig.json`,
`npm run check:tokens`, and `npx vite build`; fix failures introduced by the fixes.
Report exact commands and counts, files changed, choices made, and any unresolved
findings. Do not report the reviewer has accepted the changes. Do not commit.
