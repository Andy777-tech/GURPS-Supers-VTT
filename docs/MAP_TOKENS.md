# Persistent map tokens (schema 1.6.5)

`MapModel.tokens` owns placed instances: cell position (`col`, `row`), facing
0–7, label, footprint offsets, and an optional campaign character or NPC template
link. `Participant.tokenRef` identifies the map and token. A shared NPC template
can supply any number of separate instances. Movement records stay on combat
turn decisions and use `col`/`row` plus stable source/destination tile IDs.

On a tactical map, **Place token** arms placement; the token editor selects and
edits existing instances. Changing width or height replaces the footprint with a
rectangle. Other edits preserve its existing shape. Dragging any occupied cell
preserves the anchor offset. Esc exits token editing or cancels armed placement.
**Start combat** opens the existing encounter setup with the map's linked tokens;
unlinked tokens remain scenery. Ordinary setup can select a combat map, reuse
matching placed tokens, and leave unmatched participants unplaced until the GM
places them. Ending combat or removing participants leaves their tokens intact.
Changing the active combat map detaches old references, reuses matching tokens on
the destination, and clears the previous map's movement and undo history.

Pointer moves only draw local preview geometry. A changed valid drop dispatches
one `map/moveToken` action; combat movement updates the token, movement record,
and log together. Canceled, unchanged, malformed, out-of-bounds, or overlapping drops do not
persist. Placement and resizing reject overlap with other token footprints; rejected
editor operations retain the draft and show an error for a valid retry. Existing
overlapping saves are preserved so the GM can select tokens and move them apart.
Existing movement budgets/cost behavior remains; path enforcement is
Phase 17b step 3.

Combat history is shared per campaign store across the existing map and combat
consumers. Token moves record combat snapshots and stable tile IDs. Undo/redo
restores canonical positions and bookkeeping together, including after top/left
expansion. Initial placement can be undone/redone without duplicating tokens.
If a later footprint edit makes a historical destination invalid, undo/redo is
rejected without advancing its cursor; maneuver reset likewise retains the
existing movement when its return destination is invalid.

## Migration fallback

Both the raw 1.6.4 → 1.6.5 migration and the typed hydration fixup use
`migrateMapTokens`. They visit live maps/combat, archived combat, and
`checkpoints.entries[].snapshot`. Older flat `combatActive`, `combatHistory`, and
`combatActiveHistory` storage also has its spatial records rewritten. GM unlock
uses the export envelope's original schema version before merging decrypted data.

- Every map gains a token collection, including overland maps.
- A valid legacy active participant position creates an instance ID derived
  deterministically from combat ID and participant instance ID (falling back to
  its old ID or array index). NPC template IDs never merge instances.
- Existing valid tokens/references take precedence. Legacy positions never move
  existing tokens. Archived positions never create or move live tokens.
- Removed participant position/facing fields are retained in `legacySpatial`.
  Missing maps, invalid coordinates, and unresolved references remain there for
  recovery, with no invented live map or off-grid token.
- Malformed token entries are isolated under the map's `legacyTokens` field.
  Non-object map entries are isolated under the map slice's `legacyMaps` field.
  Unknown extension fields survive. Repeated migration preserves IDs, counts,
  and unchanged object references.
- Combat-only import has no reliable campaign identity. It always detaches
  foreign map/token references into `legacySpatial` and normalizes movement
  coordinates, preventing accidental matches to local token IDs.

Missing/deleted references resolve as unplaced. A GM may explicitly place an
unresolved participant again. Both map surfaces filter active combat tokens and
labels through the same reveal policy; fully hidden NPCs are absent from the
player map projection. Group and vehicle projections remain separate.
Departing combat participants retain their effective visibility and filtered
player label in `token.playerDisplay`, so ending combat or removing an NPC does
not expose its hidden identity on the standalone map.

Full exports serialize Sets as arrays, including map visibility and checkpoint
data. Full import and GM unlock validate new-format token collections before
merging. Legacy malformed entries are quarantined by migration first.

## Verification

Independent state/migration/history and UI/lifecycle reviews accepted the final
changes. The complete suite passes: **333 files, 4,611 tests**, including server
integration. Strict TypeScript, theme tokens, and Vite build pass. Largest output
chunk is 658.36 kB; the existing >500 kB chunk warning remains.

Browser verification covered linked placement, 2×2 resizing, dragging from an
interior footprint cell, reload persistence, fresh map-to-encounter startup,
combat-end persistence, and frame-control accessibility. A separate malformed
save probe verified quarantine, subsequent map expansion, and migration
idempotence. Specs and compressed run logs are under `docs/codex-specs/`;
`CODEX_PROVENANCE.jsonl` records authorship and verification.

Next roadmap slice: Phase 17b step 3, movement enforcement.
