# save-safety review triage (2026-10-02, from logs A lines 5074-5240, B lines 5338-5490)

Verdict per finding, all checked against a9701e2 source. Fix shape is what I will implement.

## Real — fix
| ID | Finding | Fix |
|---|---|---|
| A1 | checkMigrationNeeded uses storage.get (swallows read errors) → migration overwrites unreadable campaign | add strict `readRaw` to window.storage; campaign read throw → false (load path then records `unreadable`); legacy read throw → counts as present (migration then fails loudly, legacy untouched) |
| A2/B1 | migration writes campaignState via window.storage.set: no revision, no baseline, no absence check | `commitMigratedCampaignState()` in campaignStorage: through saveQueue, `writeWithRevision({requireValueAbsent:true})`, sets sessionRevision; migrateToV2(commit) required param; drop stringifyWithSets; App: on null result re-check, load if a campaign appeared |
| A3/B-U2 | overlapping loads (StrictMode double effect) — older load saves/prunes over newer | App: `if (cancelled) return` after every await; loadCampaignState single-flight |
| A4 | loadIssue assigned after `await preserveUnreadableSave` | assign loadIssue first, fill recoveryKey after |
| A5 | prune uses stale snapshot, can delete another tab's new asset | re-read stored revision before prune, skip if moved; `pruneUnreferencedAssets(state, store, {minAgeMs})`, production 1 h (asset put precedes campaign commit) |
| A6 | localStorage fallback: value written, revision write throws → divergence | write revision first, then value; roll revision back if value write throws |
| A7 | legacy read failure → null → silently dropped | strict readRaw in loadLegacyData |
| A8 | `campaignState = ''` treated as missing | `raw === null` |
| A9 | rollback writes decoded strings unencoded | JSON.stringify every value |
| A-U1 | lazy LS→IDB migration: readonly check then unconditional put can clobber a newer commit | single readwrite txn: get, put only if still absent |
| A-U3 | IDB open failure → silent LS fallback → fresh unblocked campaign | `idbOpenFailed` flag; readRawStrict / writeWithRevision throw StorageUnavailableError |
| A-U4 | LS cleanup throw after committed IDB write rejects the save → self-conflict | `removeLocalCopy` try/catch (also backendSet) |
| B2/B-U3 | conflict / load issue raised before banner mounts or after → invisible | persistent health in campaignStorage: `getCampaignSaveHealth()` + `campaign-save-health` event on loadIssue/conflict change; banner reads + subscribes |
| B3 | start-fresh doesn't save changes made while blocked | provider dirty flag (change seq); on health event with no loadIssue and dirty → save; flush saves if timer pending OR dirty |
| B4 | cancelled initializer sets 'migrating' and migrates | covered by App cancel checks |
| B5 | quota banner stays after successful retry | hide on campaign-save-ok |
| B-U1 | Electron close doesn't await queued save | main 'close' → preventDefault, send `campaign:flush-request`, await `campaign:flush-done` (5 s timeout), then close; preload always answers (immediately if no handler); provider registers flush + `whenCampaignSavesSettled()` |

## Downgraded / dropped
- A-U2 (LS cross-tab lock): LS path only when IndexedDB is absent (jsdom, sandboxed); read-decide-write is synchronous in one task; residual race is the browser's lack of a storage mutex. Not fixing.
- B5 second half (breakdown measures only localStorage): UI-overhaul item.
- Quota retry discards retry error: documented behaviour, rethrows original quota error. Not fixing.
- rollbackMigration direct writes: no production caller (tests only). Note only.

## Tests to add
storage LS ordering+rollback, requireValueAbsent, IDB-open-failure (fake indexedDB global + resetModules); campaignStorage empty string, loadIssue-before-preserve, single-flight, prune skip on moved revision + minAge, commitMigrated baseline/refusal, health getter for pre-mount conflict; dataMigration strict legacy failure, campaign read failure, rollback strings; provider start-fresh resave, Electron flush handler; banner pre-mount conflict, post-mount load issue; App failure→retry, StrictMode single migration. IDB txn paths (lazy-migration recheck, cleanup isolation, requireValueAbsent) verified in browser pane via dynamic import.

## FIX1 round (2026-10-02, session 5)
Spec `save-safety-REVIEW-FIX1-SPEC.md` (sha256 82c635c1…), one read-only gpt-6.1-sol round (codex-cli 0.159.3, 174,798 tokens), log `logs/save-safety-review-fix1.log.gz`. The final report starts at the LAST `## VERIFIED BUGS` line, which in this log comes AFTER the last `tokens used` line (log lines 7387-7506); the handoff's awk one-liner prints nothing for this log. Reviewer marked 19 of 21 round-one rows CLOSED, A5 and B-U1 PARTIAL, and agreed with the four downgrades (A-U2's "one synchronous task" reasoning called weak; residual race stands as documented).

| ID | Finding | Verdict | Fix / test |
|---|---|---|---|
| F1 (sev 1, A5 incomplete) | Prune deletes an old asset that another tab re-imports (idempotent put kept the old createdAt) and commits after the revision check | REAL, reproduced (new test failed on 0ca1615) | `put` of an existing id refreshes `createdAt`; new `AssetStore.deleteIfStoredBefore(id, cutoff)` decides and deletes in one IDB readwrite txn; prune uses it when `minAgeMs > 0`. Tests: two race tests in assetMigration.test.ts, boundary test + updated idempotence test in assetStore.test.ts. Mutations killed: no refresh, read-then-delete, `>=`→`>` boundary. IDB backend browser-verified 2026-10-02 (session 6; browser pane, real IndexedDB, `vite --port 3008 --strictPort`, `import('/src/assets/assetStore.ts')` + `createIndexedDbAssetStore()`, random 64-byte test assets): a repeat `put` of the same bytes keeps the id, bytes and first mime and moves `createdAt` forward (+30 ms); `deleteIfStoredBefore` with a cutoff taken between the two puts returns false and keeps the asset; cutoff equal to `createdAt` returns false; cutoff `createdAt + 1` returns true and deletes; a missing id returns false. Served mutants (temporary source edits, reverted): dropping the refresh in the IDB `insert` let the race delete go through; `<`→`<=` deleted at the equal cutoff. Test assets removed; the origin's asset store was empty before and after. Residual (not fixed): another tab referencing an asset older than 1 h from in-memory state without a put (e.g. undo restoring a removed image) can still lose it; needs cross-tab coordination, deferred to the state-ownership phase. |
| F2 (sev 1 unverified) | A second `loadCampaignState()` while the provider is mounted clears `loadIssue` before reading, so a dirty provider saves over the damaged save | REAL at function level, reproduced (save landed on `not-valid-json`); no UI route calls load while mounted today | `settleLoad(baseline, issue)`: the load keeps the previous issue, conflict flag and revision baseline until it knows the outcome, then installs them together. Tests: "keeps saves blocked while a reload of a damaged save is still reading" (kills clearing the issue at load start), "keeps the conflict guard on while a reload is still reading" (kills nulling the baseline; does NOT kill adopting the baseline right after the first await, because queue timing runs the save first — limitation, not timing-hacked). |
| F3 (sev 2, B-U1 incomplete) | Close handshake acknowledges a failed or refused final save | REAL (renderer replayed) | Renderer flush handler returns `{ unsaved }`; preload forwards it (handler throw → unsaved); main closes only on `unsaved: false`, otherwise (and on the 5 s timeout) shows "Keep the window open / Close without saving"; keeping it open re-arms the handshake; no stacked dialogs. Tests: fail and blocked saves → `{ unsaved: true }`; no changes → no save. |
| F4 (sev 2, B-U1 incomplete) | Change made while the final save runs is not covered | REAL | Handler loops up to 3 passes: await queue, return if clean, else flush. Tests: "also saves a change made while the final save was running" (kills 1 pass), the basic test (kills a missing await). Equivalent mutant: flush before the clean check (only an extra save). |
| F5 (own review) | `before-quit` shuts the multiplayer server down even when the quit is then cancelled by the close dialog | REAL by reading | Server shutdown moved to `will-quit`. |
| Test gaps | settled mocked everywhere; reveal sets empty in seeds; rollback test overclaims; quota retry untested | Accepted | New: real `whenCampaignSavesSettled` ordering test (kills `Promise.resolve()`), non-empty reveal sets through migration + hydrate (kills `new Set()`), quota retry drops checkpoints (kills keeping them). Rollback test renamed with a note (rollback has no production caller). Not done: automated IDB late-abort test (no IDB in jsdom; browser-verified paths only). |

Electron (`main.ts`, `preload.ts`) is still neither type-checked nor run on draken; `dialog.showMessageBox(win, opts)` → `{ response }` and `will-quit` are standard Electron API but unverified here.
