# DISPATCH: final map-token control placement and occupancy corrections

On `codex/map-owned-tokens`, preserve others' edits and do not commit. The main
map-token implementation and FIX1 corrections are already in progress/completed.
This is a bounded correction pass, not a redesign or another broad audit.

Browser verification confirmed header controls are now clear, but the token editor
still covers **Frame active group** inside the map canvas. `TokenEditor.tsx` has
`absolute right-3 top-3 z-20`; `Map3DView.tsx` puts the frame control at
`absolute right-3 top-3 z-10`. Coordinate their placement so both controls are
visible and clickable while the token editor is collapsed or expanded, at the
normal 1265×712 browser size. Prefer a minimal placement/spacing change preserving
the existing layout. Do not fix the unrelated preexisting sidebar NPC badge.

Final review also confirmed FIX1 finding 5's explicit non-stacking requirement
was not implemented. Restore the previous combat occupied-destination behavior
at the shared domain boundary, for add/move/footprint resize: reject footprints
that overlap another persisted map token, excluding the token itself. Check all
occupied footprint cells, not just anchors. Do not include overland presentation
group/vehicle markers in this rule. Rejected movement must leave token, movement
bookkeeping, and history untouched. Add meaningful tests for interior-cell
collision, resize collision, self-overlap during a legal move, and legal adjacent
footprints. Do not discard or relocate old overlapping tokens during hydration;
they remain selectable through the existing selected-token preference so a GM
can move them apart. This preserves existing movement semantics while new
movement enforcement remains deferred to step 3.

Check relevant UI/token reducer tests, tsc, and theme gate; state what changed. No new test is
needed merely to assert Tailwind class strings. The shepherd will visually verify
the frame control alongside the token editor. Do not change other behavior, specs,
provenance, or the roadmap.
