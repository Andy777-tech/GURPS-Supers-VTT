# DISPATCH: token editor feedback for rejected collisions

Make one bounded fix on `codex/map-owned-tokens`. You are the delegated
implementer, own TokenEditor and its tests, and must preserve all others' edits.
Do not commit, install dependencies, or repeat the project survey. Main token
work and collision checks are complete; full independent suite currently passes
333 files / 4,609 tests, tsc/build/theme gate pass.

New collision rejection is correct in the reducer, but the editor's placement
click path still checks only bounds (`tokenFitsMap`), dispatches addToken, then
leaves placement mode and selects a token id even when the reducer rejected the
colliding token. Save similarly clears its error despite rejected colliding
footprint updates. This creates an editor for an unsaved/nonexistent token.

Use the SAME shared placement/occupancy predicate as the reducer for editor
preflight (or authoritative acceptance feedback); do not duplicate cell collision
logic in UI. On a rejected placement, persist nothing, show a clear error, and
remain armed so the GM can click a valid cell. On rejected save, retain the draft
and selection, show a clear error, and do not pretend it was saved. Valid retry
must clear the error and commit normally. Preserve shape/bounds validation and
existing escaped/canceled placement behavior.

Add meaningful tests against the real campaign provider/reducer for colliding
placement then valid retry, and colliding footprint resize/save then valid retry.
Tests must assert UI mode/error AND persisted token count/geometry so a mocked
dispatch cannot hide rejection. Run targeted TokenEditor/mapOwnedTokens tests,
tsc and theme gate. Do not expand scope beyond this feedback path.
