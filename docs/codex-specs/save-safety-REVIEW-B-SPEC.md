# Read-only review: save-safety phase (branch `refactor/save-safety`)

You are the reviewer. Do not run codex, do not spawn sub-agents, do not read or follow any skill under ~/.agents/skills/, ~/.codex/skills/ or ~/.codex/plugins/. Review the diff yourself and report to stdout.

**Mode: READ-ONLY.** Do not edit, create or delete any file (your sandbox blocks writes anyway, including /tmp). Do not run `npm install`. Nothing in this repo spends money; there are no paid APIs to avoid. Safe commands: `git diff`, `git log`, `git show`, `rg`, `sed -n`, `npx tsc --noEmit`, `npx vitest run <file>` (may fail in your sandbox because vite writes a cache under the symlinked, read-only `node_modules`; if so, say so and reason instead — the author has already run the suites, results below).

## What this is

A GURPS 4e campaign manager (React 18 + TS strict + Vite, Electron shell). The whole campaign is one JSON blob in IndexedDB (`gurps-vtt-storage` / store `kv`, key `campaignState`, with localStorage as fallback and as a lazily-migrated legacy location). It is the owner's real, years-old campaign data, and there is no server copy. **Losing or silently overwriting it is the worst outcome this codebase can produce.**

The driving review is `docs/codex-specs/REFACTOR_DEEP_REVIEW.md` (your own earlier deep review); the handoff is `docs/REFACTOR_HANDOFF.md`. This phase addresses that review's save-safety findings. Diff to review: `git diff 69544aa..HEAD` (two commits: the WIP `d2f27f6` and the follow-up `c067395`).

What the phase claims to guarantee:
1. If a stored campaign exists but cannot be read (backend error) or decoded/hydrated, the session starts on a blank campaign **and no save can overwrite the stored campaign** until the user explicitly confirms "start fresh". The undecodable bytes are copied to `campaignState_unreadable_*` first.
2. A save is a compare-and-write: on IndexedDB, reading the revision, deciding, and writing value + revision happen in ONE readwrite transaction, so a second tab cannot slip a save in between, and value and revision commit or fail together. A session whose stored revision moved past its own refuses to save (cross-tab guard).
3. Saves from one session are serialized (no two overlapping saves stamping the same revision); a failed save does not jam the queue.
4. A pending debounced autosave is flushed (not dropped) on `pagehide`, on `visibilitychange` → hidden, and on provider unmount.
5. Legacy v1 → v2 migration aborts (leaving legacy keys untouched) rather than writing defaults when stored legacy values do not decode; it no longer writes a second party inventory or duplicate character inventories.
6. App init failure shows an error with "Try again" instead of an infinite spinner.

## Framing

A different AI (Claude) wrote this in one session and is likely overconfident. It already found and fixed real defects in its own work late in the session (duplicate party/character inventories in the v1 migration; one full-size recovery copy written per reload while a save stays broken; recovery-key collisions within one millisecond; an "unreadable" load whose only exit overwrote the possibly-intact save). Assume there are more. Its tests were written by the same reasoning as the code — check whether they can actually fail.

## Severity — rank by blast radius

1. **Data loss or silent overwrite** of the stored campaign or of the recovery copy, on any path (load, migration, save, quota-prune retry, cross-tab, Electron close, StrictMode double effects, the lazy localStorage→IDB migration in `backendGet`).
2. **Silent wrong**: a guard that passes when it should block, a banner that never shows, a save reported OK that did not commit, a revision that does not move.
3. Ordinary correctness.
4. Vacuous tests: a test that would pass against broken code. Mutation is the bar — for each guarantee above, name the one-line break that should make a test fail, and say whether one does.
5. Style, briefly, last.

## Evidence

Every finding: `file:line`, a concrete reproducing sequence (input/state → steps), actual result, expected result. Anything you did not trace end-to-end is labelled **UNVERIFIED**. You may find nothing serious; that is less likely than you think.

## Your scope

**Reviewer B — cross-cutting: React wiring, UI, and "what breaks tomorrow".** Go deep on `src/state/campaignStore.tsx` (the autosave effect: debounce, `flush` on pagehide / visibilitychange / unmount, the save-ok / save-failed events), `src/components/ui/SaveHealthBanner.tsx`, `src/components/ui/StorageQuotaBanner.tsx` (cleanup buttons now dispatch real actions — check those actions exist and do what the button says), `src/App.tsx` (init failure + retry, the `cancelled` flag, React StrictMode double effects in dev), and the new tests `src/state/__tests__/campaignStoreAutosave.test.tsx` and `src/components/ui/__tests__/SaveHealthBanner.test.tsx`. Questions to answer explicitly: is there any path where the user is NOT told their campaign isn't being saved (e.g. a banner mounted after an event already fired, a load issue set after mount, a conflict announced once and then lost)? Does "start fresh" actually resume saving, and could a user reach it by accident? In Electron (`electron/main.ts`) does closing the window give the pagehide/unmount flush a chance to complete, or is the async save killed mid-write? Does anything else in the app (export/import in `src/utils/exportImport.ts`, checkpoints, GM unlock, multiplayer sync in `src/net/`) write `campaignState` or its revision key while bypassing the new guard? Reviewer A covers `storage.ts`, `campaignStorage.ts` and `dataMigration.ts` internals; treat their contracts as given unless the wiring depends on a detail you can see is wrong.

## Author's verification so far

`npx tsc --noEmit` clean; full `npx vitest run` 335 files / 4640 tests passed; `server/` vitest 6 files / 88 passed; theme-token gate passed. Browser pane (real Chromium IndexedDB): fresh save went to IDB with revision 1 and nothing in localStorage; corrupting `campaignState` in IDB and reloading showed the load-failure banner; a UI change plus a `pagehide` left the corrupt original and revision untouched; the recovery copy held the original bytes; two further reloads added no copies; confirming "start fresh" then a UI change stored the new campaign at revision 2 and kept the recovery copy. Not exercised in a browser: the cross-tab conflict on IDB, the quota-prune retry, Electron window close.

## Report format (stdout, Markdown, these sections in order)

## VERIFIED BUGS
`- [sev 1-5] file:line — title` then repro / actual / expected / fix shape.

## UNVERIFIED CONCERNS
Same shape, labelled.

## TEST GAPS AND VACUOUS TESTS
Per guarantee: the mutation, and whether an existing test catches it (name it).

## CHECKED AND OK
Mandatory. What you traced and found correct, specifically enough that silence can be told apart from coverage.
