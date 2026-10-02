# Read-only review FIX1: save-safety review fixes (commits 0ca1615 + 7180346)

You are the reviewer. Do not run codex, do not spawn sub-agents, do not read or follow any skill under ~/.agents/skills/, ~/.codex/skills/ or ~/.codex/plugins/. Review the diff yourself and report to stdout.

**Mode: READ-ONLY.** Do not edit, create or delete any file (your sandbox blocks writes anyway, including /tmp). Do not run `npm install`. Nothing in this repo spends money; there are no paid APIs to avoid. Safe commands: `git diff`, `git log`, `git show`, `rg`, `sed -n`, `npx tsc --noEmit`, `npx vitest run <file>` (may fail in your sandbox because vite writes a cache under the symlinked, read-only `node_modules`; if so, say so and reason instead — the author has already run the suites, results below).

## What this is

A GURPS 4e campaign manager (React 18 + TS strict + Vite, Electron shell). The whole campaign is one JSON blob in IndexedDB (`gurps-vtt-storage` / store `kv`, key `campaignState`, with localStorage as fallback and as a lazily-migrated legacy location). It is the owner's real, years-old campaign data, and there is no server copy. **Losing or silently overwriting it is the worst outcome this codebase can produce.**

This is the second review round of the save-safety phase. In round one, two reviewers (A: storage/persistence, B: React wiring/UI) reviewed `git diff 69544aa..a9701e2` with the specs `docs/codex-specs/save-safety-REVIEW-A-SPEC.md` and `save-safety-REVIEW-B-SPEC.md` (read them for the phase's six claimed guarantees). Their findings were triaged in **`docs/codex-specs/save-safety-REVIEW-TRIAGE.md`**: 17 accepted with a fix shape, 4 downgraded or dropped with a stated reason. Read that file first; its IDs (A1..A9, A-U1..A-U4, B1..B5, B-U1..B-U3) are what you report against.

Diff to review: **`git diff a9701e2..7180346 -- src electron`** (two commits: `0ca1615` implements the triage fixes, `7180346` adds tests). `git diff 69544aa..7180346 -- src electron` is the whole phase if you need the earlier context. Ignore `docs/`.

New guarantees the fix round adds on top of the phase's six:
7. Migration never overwrites a stored campaign: the v1→v2 migration detects an unreadable `campaignState` (strict read) and does not run; its commit goes through the save queue with `writeWithRevision({ requireValueAbsent: true })` and baselines the session revision.
8. One load per session: `loadCampaignState` is single-flight, and `App.tsx` bails out after every `await` once the effect is cancelled (StrictMode double effect).
9. Users are always told: save health (load issue, conflict) is persistent state in `campaignStorage` (`getCampaignSaveHealth()` + a `campaign-save-health` event), so a banner mounted after the event still shows it.
10. Value and revision cannot diverge on the localStorage fallback (revision written first, rolled back if the value write throws); the lazy LS→IDB migration re-checks absence inside its readwrite transaction; an IndexedDB open failure makes strict reads and revisioned writes throw `StorageUnavailableError` instead of falling back to an empty localStorage.
11. Quota prune cannot delete another tab's new asset (skipped if the stored revision moved; assets younger than 1 h are never pruned).
12. A pending or dirty save is flushed on Electron window close (main → `campaign:flush-request`, renderer awaits queued saves → `campaign:flush-done`, 5 s timeout).

## Your task

1. **Per triage row:** for each accepted finding, does the fix as written actually close the finding's repro? Quote the `file:line` that closes it, or give the sequence that still reproduces. For each downgraded/dropped finding, is the stated reason correct?
2. **Regressions:** did any fix break something that worked at a9701e2? In particular: the save queue still survives a failed save; a normal fresh install (no stored campaign, no legacy keys) still starts with sample data and saves at revision 1; "start fresh" still resumes saving; existing campaigns at schema v2 never enter the migration path; the quota-retry path still saves; StrictMode in dev does not migrate or load twice and does not leave the UI on a spinner; the new `dirty` / resave-on-health-event logic in `campaignStore.tsx` cannot loop (save → health event → save ...) or save while a load issue is unacknowledged.
3. **New code paths:** `requireValueAbsent`, `ValueAlreadyPresentError`, `StorageUnavailableError`, `idbOpenFailed`, `commitMigratedCampaignState`, `whenCampaignSavesSettled`, `getCampaignSaveHealth`, the `minAgeMs` prune gate. Any IDB transaction abort/error path that resolves as success or leaves a promise pending forever? Any error class that a caller catches too broadly (e.g. a conflict treated as a quota error, or `StorageUnavailableError` treated as "missing")?
4. **Electron (`electron/main.ts`, `electron/preload.ts`, `src/types/electronApi.d.ts`):** these files are **not type-checked and have never run** — electron is not installed on the author's machine and `tsconfig.json` does not cover `electron/`. Read them as untested code: API misuse (`ipcMain` / `ipcRenderer` / `contextBridge` signatures, `BrowserWindow` `close` event, `event.preventDefault()` then `win.close()` / `win.destroy()` re-entry), a close that can hang forever, a close that can never complete, quit-on-macOS / `before-quit` interaction, a listener leak per window, a mismatch between the preload's exposed shape and `electronApi.d.ts` or the provider's use of it.
5. **Tests (7180346):** the author mutation-checked 35 mutations. Pick the guarantees above where you think a one-line break would survive, name the mutation, and say whether a test catches it (name it). Look for tests that assert on mocks rather than behavior.

## Severity — rank by blast radius

1. **Data loss or silent overwrite** of the stored campaign or of the recovery copy, on any path.
2. **Silent wrong**: a guard that passes when it should block, a banner that never shows, a save reported OK that did not commit, a revision that does not move, a window close that drops a pending save.
3. Ordinary correctness (including a close that hangs, a spinner that never ends).
4. Vacuous tests.
5. Style, briefly, last.

## Framing

A different AI (Claude) wrote both the fixes and the tests, and is likely overconfident. Round one found 17 real defects in code it had already self-reviewed; the fixes add about 450 lines of new concurrency and error-handling code, which is where new defects live. The tests were written by the same reasoning as the fixes — check whether they can fail.

## Evidence

Every finding: `file:line`, a concrete reproducing sequence (input/state → steps), actual result, expected result. Anything you did not trace end-to-end is labelled **UNVERIFIED**. You may find nothing serious; that is less likely than you think.

## Author's verification so far

`npx tsc --noEmit` clean (does not cover `electron/`); full `npx vitest run` 337 files / 4688 tests passed; `server/` vitest 6 files / 88 passed; theme-token gate passed. 35 mutations against the fix code, all killed by the 7180346 tests. Browser pane (real Chromium IndexedDB, `import('/src/utils/storage.ts')` in the page): lazy LS→IDB migration moves the value and removes the LS copy; a put from a second connection landing between the readonly check and the migration transaction is kept (and with the recheck removed, the legacy copy overwrote it); `requireValueAbsent` refuses a second write with IDB unchanged, also when the value exists only in localStorage; a throwing `nextRevision` aborts with nothing written; a throwing `localStorage.removeItem` on the stale copy does not fail `writeWithRevision` or `storage.set`. Not exercised anywhere: Electron window close.

## Report format (stdout, Markdown, these sections in order)

## VERIFIED BUGS
`- [sev 1-5] file:line — title` then repro / actual / expected / fix shape. Prefix the title with the triage ID when the bug is an incomplete fix of a round-one finding (e.g. `A5 incomplete:`), or `NEW:` otherwise.

## UNVERIFIED CONCERNS
Same shape, labelled.

## TEST GAPS AND VACUOUS TESTS
Per guarantee: the mutation, and whether an existing test catches it (name it).

## CHECKED AND OK
Mandatory. One line per triage ID (A1..A9, A-U1..A-U4, B1..B5, B-U1..B-U3, plus the four downgraded items) saying CLOSED / NOT CLOSED / PARTIAL with the closing `file:line`, then what else you traced and found correct, specifically enough that silence can be told apart from coverage.
