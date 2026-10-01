## 1. Summary

The project has substantial behavioral coverage and passes client/server TypeScript checks, but several boundaries remain unsafe.
The refactor should begin with persistence and workflow correctness before moving components or changing navigation.

1. **High:** Legacy migration silently loses data with the real storage API; rollback cannot read its own backup.
2. **High:** Failed campaign hydration returns sample data that can subsequently overwrite the saved campaign.
3. **High:** Campaign import is disconnected from dispatch, and normalized “player-safe” exports expose GM secrets.
4. **High:** Map combat ends through a different path that bypasses the normal summary, loot, and journey-resumption workflow.
5. **Med:** Duplicate state ownership, incomplete multiplayer wiring, ineffective TypeScript linting, and large components weaken refactor protection.

No source files were changed. The existing untracked review spec was preserved.

## 2. Verification results

Reviewed checkout: `69544aa4b014cfbdeae84f47ce9532ead863fefd`.

| Check | Result |
|---|---|
| Client TypeScript | **PASS**, zero errors |
| Server TypeScript | **PASS**, zero errors |
| Electron TypeScript | **FAIL**, four errors: missing Electron declarations, `process.resourcesPath`, and `Electron` namespace |
| Root Vitest | **332 files passed, 1 failed**; **4,587 tests passed, 24 skipped** |
| Server Vitest | **2 files passed, 4 failed**; **25 tests passed, 63 failed** |
| ESLint | **344 errors, 347 warnings**, including **10 fatal parsing errors** |
| Theme token gate | **PASS** |

The root suite’s failing server-integration setup encountered `listen EPERM`; teardown then accessed an undefined server. The server suite also encountered denied socket listening, including Supertest’s implicit listeners. These results do **not** establish server behavior failures; the network suites need rerunning where listening is permitted.

ESLint’s totals are heavily contaminated by generated and parked content:

| Scope | Errors | Warnings | Fatal |
|---|---:|---:|---:|
| `.claude/` | 232 | 234 | 6 |
| `dist/` | 100 | 110 | 4 |
| `src/`—JavaScript only | 1 | 3 | 0 |
| Other files | 11 | 0 | 0 |

Exact verification invocations:

```bash
npx tsc --noEmit
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p electron/tsconfig.json
npx vitest run
# Working directory: server/
npx vitest run --config vitest.config.ts
# Working directory: repository root
npx eslint . --format json
node scripts/check-theme-tokens.mjs
graphify query 'campaign persistence reducer store navigation UI primitives'
graphify explain campaignReducer
```

ESLint JSON was summarized with an in-memory Node pipeline. Additional read-only AST analysis counted assertions, traced imports, and checked app reachability. In-memory Node probes reproduced migration loss, plaintext secret exposure, malformed-input crashes, and concurrent-save behavior.

The graph was built at `538b57c8`, so its anchors were checked against current source. No graph update, install, build, coverage generation, or browser verification was performed. Bundle measurements below describe existing artifacts.

## 3. Findings by area

### 1. Architecture and state

The Immer/domain-reducer architecture is real. However, the claimed single-store and thin-router conventions are only partly followed.

- **[high] [CombatContext.tsx:434](/home/arlavale/Meta/projects/gurps-calculator/src/components/combat/CombatContext.tsx:434), [CombatTracker.tsx:534](/home/arlavale/Meta/projects/gurps-calculator/src/components/combat/CombatTracker.tsx:534)** — Map combat’s End Combat handler immediately archives and clears combat. The tracker instead enters summary/loot and resumes an interrupted journey on completion. Refactoring either implementation independently preserves divergent behavior → introduce one end-combat workflow consumed by both layouts, with parity tests for summary, party resource synchronization, loot, and journey resumption.

- **[med] [DowntimeContext.tsx:147](/home/arlavale/Meta/projects/gurps-calculator/src/components/downtime/DowntimeContext.tsx:147), [campaignReducer.ts:1468](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignReducer.ts:1468)** — Downtime has a local `useReducer` plus two effects synchronizing whole slices in both directions. Campaign dispatch only accepts `setDowntime`, rather than domain actions. This complicates undo, external state replacement, and atomic cross-domain changes → delegate downtime actions inside the campaign reducer; retain a context only for stable commands or presentation data.

- **[med] [campaignReducer.ts:115](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignReducer.ts:115), [campaignStore.tsx:181](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignStore.tsx:181), [UnifiedShell.tsx:126](/home/arlavale/Meta/projects/gurps-calculator/src/unified/UnifiedShell.tsx:126)** — The reducer is 1,496 lines, store 1,096, and shell 985. State definitions, action definitions, command wrappers, orchestration, and rendering are concentrated together → extract state/action contracts first, then domain command factories, cross-domain workflows, and shell panes without changing persisted structure.

- **[med] [campaignReducer.ts:653](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignReducer.ts:653), [craftingActions.ts:31](/home/arlavale/Meta/projects/gurps-calculator/src/state/crafting/craftingActions.ts:31)** — Character, crafting, alchemy, and gathering actions are redeclared in `CampaignAction` despite having domain unions. Guards maintain additional action-name sets. Payload changes therefore require coordinated edits across multiple definitions → compose the campaign union from authoritative domain unions; test that every domain action reaches its handler. The inspected guards route by action name, not runtime payload validation.

- **[med] [campaignStore.tsx:1012](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignStore.tsx:1012), [characterSelectors.ts:24](/home/arlavale/Meta/projects/gurps-calculator/src/state/selectors/characterSelectors.ts:24), [inventorySelectors.ts:36](/home/arlavale/Meta/projects/gurps-calculator/src/state/selectors/inventorySelectors.ts:36)** — The subscription store supports selective reads, but 64 production files reference the whole-store hook. Many selectors allocate fresh arrays on every call; material aggregation also repeatedly searches accumulated totals. Structural cleanup alone will retain broad rerenders → migrate hot consumers to stable selectors, memoize against relevant entity references, and aggregate holdings with a keyed map.

- **[med] [InventoryTab.tsx:72](/home/arlavale/Meta/projects/gurps-calculator/src/components/inventory/InventoryTab.tsx:72), [ManagerTab.tsx:200](/home/arlavale/Meta/projects/gurps-calculator/src/components/ManagerTab.tsx:200)** — Inventory list replacement and material-type renaming dispatch multiple independent mutations from components. One user operation creates intermediate states and multiple global undo entries → add atomic domain commands such as replacing owner holdings and renaming a material type with its references.

- **[low] [mapUtils.ts:9](/home/arlavale/Meta/projects/gurps-calculator/src/utils/mapUtils.ts:9), [footprints.ts:2](/home/arlavale/Meta/projects/gurps-calculator/src/utils/footprints.ts:2)** — A confirmed value-import cycle joins grid utilities and footprint utilities → move primitive grid lookup into a dependency-free module. Most reducer cycles reported by the stale graph are type-only imports and should not be treated as runtime cycles.

### 2. Type safety

Counts include production and tests. Non-null counts use TypeScript AST expression nodes, excluding logical negation.

| Scope | `as any` | `@ts-ignore` | `@ts-expect-error` | Non-null assertions |
|---|---:|---:|---:|---:|
| `src/` | 24 | 0 | 5 | 270 |
| `server/src/` | 3 | 1 | 0 | 17 |
| `shared/` + `electron/` | 0 | 0 | 0 | 0 |
| **Production only, combined** | **23** | **1** | **0** | **78** |

There are no `@ts-nocheck` directives in those scopes. The five `@ts-expect-error` directives deliberately exercise invalid inputs in tests.

- **[med] [ActionPanelDamageWorkflow.tsx:67](/home/arlavale/Meta/projects/gurps-calculator/src/components/combat/action-panel/ActionPanelDamageWorkflow.tsx:67), [InjuryResolutionPanel.tsx:17](/home/arlavale/Meta/projects/gurps-calculator/src/components/combat/InjuryResolutionPanel.tsx:17)** — Three casts cross locally redeclared injury/target/location interfaces. Similar bridges exist between combat-library, participant, and resource representations → define shared injury input/output and hit-location types, then explicit adapters from canonical participants. Avoid making the entire participant type looser.

- **[med] [craftingActions.ts:62](/home/arlavale/Meta/projects/gurps-calculator/src/state/crafting/craftingActions.ts:62), [campaignStorage.ts:108](/home/arlavale/Meta/projects/gurps-calculator/src/persistence/campaignStorage.ts:108), [exportImport.ts:70](/home/arlavale/Meta/projects/gurps-calculator/src/utils/exportImport.ts:70)** — Template commands accept `any`; hydration accepts unchecked map objects; the export’s serialized-state type converts combat Sets but still inherits runtime map types. These boundaries hide shape errors despite clean `tsc` → introduce a JSON-safe campaign DTO covering maps and checkpoints, decode `unknown`, and use category-indexed template payload types.

- **[med] [alchemy.ts:206](/home/arlavale/Meta/projects/gurps-calculator/src/utils/alchemy.ts:206), [alchemy.ts:807](/home/arlavale/Meta/projects/gurps-calculator/src/utils/alchemy.ts:807), [combatLogFilter.ts:199](/home/arlavale/Meta/projects/gurps-calculator/src/utils/combatLogFilter.ts:199)** — `FormulaInput` permits missing ingredients while calculation asserts they exist; resource-log filtering asserts optional text exists. Both crashed in probes with accepted/legacy-shaped inputs → require validated ingredients at calculation entry and normalize optional log text before filtering. Production hotspots include alchemy’s 12 and combat-log filtering’s 11 non-null assertions.

### 3. Dead and duplicated code

- **[med] [useCombatSession.ts:111](/home/arlavale/Meta/projects/gurps-calculator/src/hooks/useCombatSession.ts:111), [CombatContext.tsx:323](/home/arlavale/Meta/projects/gurps-calculator/src/components/combat/CombatContext.tsx:323), [CombatTracker.tsx:268](/home/arlavale/Meta/projects/gurps-calculator/src/components/combat/CombatTracker.tsx:268)** — Three implementations contain overlapping turn, maneuver, reveal, and dice workflows. `useCombatSession` and its UI store are unreachable from the app entry, while the context remains mounted → choose one shared workflow implementation, migrate both live presentations, then delete the unused implementation and redundant tests.

- **[med] [GatheringTab.tsx:1](/home/arlavale/Meta/projects/gurps-calculator/src/components/GatheringTab.tsx:1), [inventoryManager.ts:25](/home/arlavale/Meta/projects/gurps-calculator/src/utils/inventoryManager.ts:25)** — App reachability found obsolete candidates including the 1,788-line GatheringTab, InventoryManager, WorkersView, DamageAssist, RulesModal, and old persistent/batched-storage hooks. InventoryManager operates a parallel `GlobalState` model → remove candidates only after checking tests, scripts, and external consumers; preserve useful behavior tests against the live reducers. Connection components are also unreachable but represent incomplete functionality, so should not be deleted automatically.

- **[low] [ROADMAP.md:15](/home/arlavale/Meta/projects/gurps-calculator/ROADMAP.md:15), [PROJECT_STATUS.md:5](/home/arlavale/Meta/projects/gurps-calculator/PROJECT_STATUS.md:5), [KNOWN_ISSUES.md:25](/home/arlavale/Meta/projects/gurps-calculator/KNOWN_ISSUES.md:25), [.agents/skills/vtt-resume/SKILL.md:110](/home/arlavale/Meta/projects/gurps-calculator/.agents/skills/vtt-resume/SKILL.md:110)** — Documentation contradicts current code: TypeScript linting is claimed enabled; the skill says zero server auth and 203 remaining casts; known issues still describe retired `@ts-nocheck` and absent modal focus traps → reconcile current conventions/status and mark historical documents explicitly. `todo.md` retains unchecked implemented foundations; `docs/alchemy-logic.js` duplicates the calculation engine. Treat AUTO_QUEUE/AUTO_REVIEW as historical workflow records, not current specifications. `gurps-vtt-resume.skill` is absent.

The root InventoryTab and CookingTab files are compatibility reexports, not parallel implementations.

### 4. Persistence and schema

Existing tests protect important Set round trips, map fixups, ownership migration, travel groups, and assets. The dangerous gaps are at failure and version boundaries.

- **[high] [dataMigration.ts:498](/home/arlavale/Meta/projects/gurps-calculator/src/persistence/dataMigration.ts:498), [dataMigration.ts:743](/home/arlavale/Meta/projects/gurps-calculator/src/persistence/dataMigration.ts:743), [storage.ts:24](/home/arlavale/Meta/projects/gurps-calculator/src/utils/storage.ts:24)** — Legacy migration treats `{ value: string }` storage results as decoded entities. A probe migrated saved ore into an empty materials list while reporting success; rollback returned false because it expected `backup.data` on the wrapper → decode storage values once, validate legacy structures, write/read backups through the same codec, and verify migrated content before committing.

- **[high] [campaignStorage.ts:282](/home/arlavale/Meta/projects/gurps-calculator/src/persistence/campaignStorage.ts:282), [storage.ts:240](/home/arlavale/Meta/projects/gurps-calculator/src/utils/storage.ts:240)** — Parse/hydration failure returns a fresh sample campaign; backend read failures become “missing.” Subsequent autosave can replace the original campaign. A malformed reveal object reproduced a hydration exception → distinguish missing, unreadable, and invalid saves; retain original bytes, expose recovery/export, and disable autosave until recovery succeeds.

- **[high] [campaignStorage.ts:174](/home/arlavale/Meta/projects/gurps-calculator/src/persistence/campaignStorage.ts:174), [storage.ts:126](/home/arlavale/Meta/projects/gurps-calculator/src/utils/storage.ts:126)** — Revision checking, state writing, and revision stamping are separate operations. Two concurrent saves both succeeded and stamped revision `1` in a probe → serialize saves and perform comparison plus state/revision update atomically in an IndexedDB transaction; coordinate the fallback across tabs.

- **[med] [campaignReducer.ts:98](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignReducer.ts:98), [schemaVersioning.ts:16](/home/arlavale/Meta/projects/gurps-calculator/src/utils/schemaVersioning.ts:16), [dataMigrations.ts:89](/home/arlavale/Meta/projects/gurps-calculator/src/utils/dataMigrations.ts:89)** — Fresh campaign metadata says `1.0.0`, current export schema is `1.6.5`, and downtime separately says version `2`. Campaign hydration applies repair functions without a version gate; `migrateData` can relabel newer data with an older target version → establish one explicit persisted schema contract, ordered migrations, future-version rejection, and deliberate downtime migration integration.

- **[med] [campaignReducer.ts:352](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignReducer.ts:352), [campaignReducer.ts:1022](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignReducer.ts:1022), [campaignReducer.ts:1122](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignReducer.ts:1122)** — Autosave, export, checkpoint creation, import, and checkpoint restoration each implement parts of serialization or manually copy root slices. Adding a state field can preserve it in autosave yet lose it on restore → centralize DTO serialization/hydration and whole-state replacement, with explicit checkpoint and UI-preservation policies.

- **[med] [campaignStore.tsx:969](/home/arlavale/Meta/projects/gurps-calculator/src/state/campaignStore.tsx:969)** — Autosave cancels its pending 500 ms timer during cleanup and has no flush contract → provide serialized pending-save handling, visible dirty/error status, and lifecycle flushing appropriate to browser and Electron. Preserve the current quota/conflict notifications.

### 5. Tests

- **[high] [dataMigration.test.ts:35](/home/arlavale/Meta/projects/gurps-calculator/src/persistence/__tests__/dataMigration.test.ts:35)** — The migration mock returns decoded values while asserting them as `StorageGetResult`, masking the real migration loss → test with the actual storage contract and assert complete migrated holdings, characters, backup decoding, and rollback.

- **[med] [exportImport.test.ts:199](/home/arlavale/Meta/projects/gurps-calculator/src/utils/__tests__/exportImport.test.ts:199), [UnifiedShell.test.tsx:10](/home/arlavale/Meta/projects/gurps-calculator/src/unified/__tests__/UnifiedShell.test.tsx:10)** — Secret-redaction tests primarily exercise the legacy flat shape; shell tests mock network context. There is no corresponding proof for normalized secret removal, Manager import dispatch, mounted multiplayer, or map/tracker completion parity → add workflow tests through the real providers and normalized save fixtures before moving these paths.

- **[med] [campaignStorage.test.ts:453](/home/arlavale/Meta/projects/gurps-calculator/src/persistence/__tests__/campaignStorage.test.ts:453), [storage.test.ts:4](/home/arlavale/Meta/projects/gurps-calculator/src/utils/__tests__/storage.test.ts:4)** — Corruption tests accept fresh-state fallback; storage tests do not exercise a successful IndexedDB transaction. Sequential revision tests cannot detect simultaneous writers → add failed-load/no-overwrite, future-version, transaction-abort, concurrent-save, and pending-save lifecycle tests.

- **[low] [ConditionBadge.test.tsx:430](/home/arlavale/Meta/projects/gurps-calculator/src/components/combat/__tests__/ConditionBadge.test.tsx:430), [RulesViews.test.tsx:225](/home/arlavale/Meta/projects/gurps-calculator/src/components/rules/views/__tests__/RulesViews.test.tsx:225)** — Tests assert exact padding/color/width classes; some locate controls through styling. These will fail during an otherwise correct design-system migration → assert accessible names, state, urgency, and interaction; reserve pixel/class contracts for intentional visual tests.

No coverage percentage was measured. The gaps above are established from inspected tests and reproduced behavior, not inferred from suite size.

### 6. Server / multiplayer / Electron

JWT authentication, campaign membership checks, GM write authorization, rate limits, asset hash checks, and atomic database-file replacement are present. The skill’s “zero auth” claim is obsolete.

- **[high] [exportImport.ts:347](/home/arlavale/Meta/projects/gurps-calculator/src/utils/exportImport.ts:347), [routes.ts:163](/home/arlavale/Meta/projects/gurps-calculator/server/src/routes.ts:163)** — Normalized `splitState` copies the entire campaign into public data, only disabling UI flags. A probe retained hidden reagent aspects, hazards, and notes. Authenticated players also receive raw `state_json` from GET → create a shared player-safe projection for locked exports and player API responses, including checkpoints and combat history. Client visibility filters cannot protect transmitted secrets.

- **[high] [ManagerTab.tsx:253](/home/arlavale/Meta/projects/gurps-calculator/src/components/ManagerTab.tsx:253), [ManagerTab.tsx:269](/home/arlavale/Meta/projects/gurps-calculator/src/components/ManagerTab.tsx:269), [ManagerTab.tsx:513](/home/arlavale/Meta/projects/gurps-calculator/src/components/ManagerTab.tsx:513)** — Import discards returned state; unlock uses an unawaited Promise, supplies a bare lock where an envelope is required, and discards `mergeGM`’s return. Clean typing permits this through broad overloads → await the discriminated unlock result, retain the import envelope, hydrate the merged state, and dispatch it.

- **[med] [App.tsx:96](/home/arlavale/Meta/projects/gurps-calculator/src/App.tsx:96), [ConnectionManager.ts:215](/home/arlavale/Meta/projects/gurps-calculator/src/net/ConnectionManager.ts:215)** — App does not mount `SyncProvider`; ConnectionStatus/Dialog are unreachable; no production caller pushes campaign updates after hosting → wire provider, connection UI, inbound replacement, and GM outbound synchronization together. Preserve a clear offline path.

- **[med] [routes.ts:127](/home/arlavale/Meta/projects/gurps-calculator/server/src/routes.ts:127), [routes.ts:202](/home/arlavale/Meta/projects/gurps-calculator/server/src/routes.ts:202), [socket.ts:62](/home/arlavale/Meta/projects/gurps-calculator/server/src/socket.ts:62)** — Creation only checks truthiness, updates only check JSON parseability, and room joining destructures an unchecked payload. Malformed requests can enter storage or throw in event handlers → validate shared request/event schemas, including string types, supported campaign version, and payload shape; return controlled errors.

- **[med] [SyncProvider.tsx:104](/home/arlavale/Meta/projects/gurps-calculator/src/net/SyncProvider.tsx:104), [ConnectionManager.ts:243](/home/arlavale/Meta/projects/gurps-calculator/src/net/ConnectionManager.ts:243), [db.ts:146](/home/arlavale/Meta/projects/gurps-calculator/server/src/db.ts:146)** — Concurrent fetches can apply out of order, and server writes accept no expected version. Schema refactoring would amplify stale-state replacement risk → add request/session generation checks, monotonic applied versions, and optimistic write concurrency.

- **[low] [shared/protocol.ts:55](/home/arlavale/Meta/projects/gurps-calculator/shared/protocol.ts:55), [socket.ts:35](/home/arlavale/Meta/projects/gurps-calculator/server/src/socket.ts:35)** — PLAYER_LIST is documented as GM-only but broadcast to the entire room. Tracked `.ts`, `.js`, and `.d.ts` protocol copies add drift risk → decide the intended recipient contract and generate/check runtime declarations from one source. Current event-name copies agree.

Electron preload is appropriately small: only `isElectron` and a version getter, with context isolation enabled and Node integration disabled. No general IPC, filesystem, or shell bridge was found.

### 7. Build and dependencies

- **[med] [eslint.config.js:9](/home/arlavale/Meta/projects/gurps-calculator/eslint.config.js:9), [package.json:19](/home/arlavale/Meta/projects/gurps-calculator/package.json:19)** — ESLint has no TypeScript parser/config and no generated/worktree ignores. Lint and format scripts still target JS/JSX, contradicting the roadmap → enable typed source linting for client/server/shared/Electron, ignore artifacts, update scripts, and establish a useful baseline.

- **[med] [package.json:7](/home/arlavale/Meta/projects/gurps-calculator/package.json:7), [electron-builder.yml:17](/home/arlavale/Meta/projects/gurps-calculator/electron-builder.yml:17), [electron/main.ts:20](/home/arlavale/Meta/projects/gurps-calculator/electron/main.ts:20)** — Package entry points at nonexistent `src/App.jsx`; Electron/build tooling and build scripts are absent. Packaged code expects `resources/app` while builder uses ASAR packaging → restore a reproducible desktop build and verify packaged server/client paths. Packaging failure is unverified; missing dependencies/typecheck failure is confirmed.

- **[med] [package.json:28](/home/arlavale/Meta/projects/gurps-calculator/package.json:28)** — Installed React is 18.3.1 while React type packages are 19.x. `jest` and `prop-types` have no imports in checked client/server sources → align runtime/types and remove unused dependencies separately. React 18 also predates the available React 19 series; a major upgrade should be a dedicated compatibility change. [React release announcement](https://react.dev/blog/2025/10/01/react-19-2)

- **[low] [UnifiedShell.tsx:23](/home/arlavale/Meta/projects/gurps-calculator/src/unified/UnifiedShell.tsx:23), [vite.config.js:8](/home/arlavale/Meta/projects/gurps-calculator/vite.config.js:8)** — Lazy feature boundaries exist, but eager CombatContext imports retain considerable combat machinery at startup. Existing artifacts contain a 566,579-byte Map3DView chunk, approximately 144,985 bytes gzip, plus large entry/Manager chunks → measure a fresh build after workflow extraction and preserve lazy Three.js loading. Existing `dist/` provenance is unverified, so these are indicative sizes.

A complete latest-version or vulnerability audit was not performed.

### 8. UI/UX inventory

The app uses state-driven navigation, without URL routes.

| Surface | User path |
|---|---|
| Header | Weather, meal buffs, calendar/time advancement, undo/redo, shortcuts |
| Party column | Select character; contextual edit, duplicate, export, compare, status, points, delete actions |
| Character pane | Sheet, skills, equipment, inventory |
| Module rail | Inventory, Downtime, Map, Manager, Rules, Changelog |
| Combat tile | Dedicated entry into setup, active combat, and history |
| Map combat | Replaces party list with participants, rail with maneuvers, main area with combat map |
| Downtime | Activity tiles → fishing, foraging, mining, alchemy, crafting, cooking, rest, trading, study, social → back |
| Manager | 22 view IDs covering content configuration, facilities, locations, vehicles, travel events, calendar, import/export, and debug |
| Map | Map selection/editing, terrain, layers, stamps, tokens, weather, travel |
| Overlays | Character creation/points/compare/status, confirmations, import/GM lock, combat setup/reinforcements, map dialogs, shortcuts |

- **[med] [UnifiedShell.tsx:368](/home/arlavale/Meta/projects/gurps-calculator/src/unified/UnifiedShell.tsx:368), [PanelLayoutContext.tsx:35](/home/arlavale/Meta/projects/gurps-calculator/src/contexts/PanelLayoutContext.tsx:35)** — Shell columns remain fixed at 220/160 pixels, with manual collapse state and no breakpoint/pin model. Collapsing the rail also clears the active module → implement the agreed responsive behavior while preserving navigation intent. The combat layout additionally hardcodes expanded widths.

- **[med] [ManagerTab.tsx:39](/home/arlavale/Meta/projects/gurps-calculator/src/components/ManagerTab.tsx:39), [MapPanel.tsx:1](/home/arlavale/Meta/projects/gurps-calculator/src/components/map/MapPanel.tsx:1), [FishingResolutionPanel.tsx:1](/home/arlavale/Meta/projects/gurps-calculator/src/components/downtime/views/FishingResolutionPanel.tsx:1)** — Manager exposes 22 destinations; MapPanel exceeds 1,280 lines and FishingResolutionPanel 1,170. These surfaces combine configuration, workflow, and detailed editing → identify task groups and extract cohesive panels before redesigning their presentation. This is source-level overload evidence, not a measured usability result.

- **[med] [ConfirmDialog.tsx:67](/home/arlavale/Meta/projects/gurps-calculator/src/components/ui/ConfirmDialog.tsx:67), [Toast.tsx:40](/home/arlavale/Meta/projects/gurps-calculator/src/components/ui/Toast.tsx:40), [check-theme-tokens.mjs:9](/home/arlavale/Meta/projects/gurps-calculator/scripts/check-theme-tokens.mjs:9)** — Shared warnings still use raw yellow colors, which the gate does not ban. Decorative domain colors remain ad hoc; spacing, typography, and control variants are not centralized → adopt semantic warning tokens and an explicit domain palette, then shared control/surface variants. The checked UI contains 821 button elements, making a Button primitive materially useful.

- **[med] [CharacterSelector.tsx:121](/home/arlavale/Meta/projects/gurps-calculator/src/components/downtime/views/shared/CharacterSelector.tsx:121), [DiceRoller.tsx:110](/home/arlavale/Meta/projects/gurps-calculator/src/components/DiceRoller.tsx:110), [TraitsSection.tsx:62](/home/arlavale/Meta/projects/gurps-calculator/src/components/character-sheet/TraitsSection.tsx:62), [AnalysisView.tsx:421](/home/arlavale/Meta/projects/gurps-calculator/src/components/alchemy/AnalysisView.tsx:421)** — Visible labels are not programmatically associated with controls; expandable/selectable divs lack keyboard semantics → use generated IDs and shared Field components; replace interactive divs with buttons/disclosures. Static analysis found 422 unlabeled-control candidates and 36 non-semantic clickable candidates, but these are screening counts, not confirmed violation totals.

- **[med] [index.css:17](/home/arlavale/Meta/projects/gurps-calculator/src/index.css:17), [BatchesView.tsx:982](/home/arlavale/Meta/projects/gurps-calculator/src/components/alchemy/BatchesView.tsx:982)** — Normal empty-state text uses `fg-faint` against `surface-1`; the defined colors calculate to approximately **3.04:1**. This is insufficient for normal-size text → reserve faint/disabled colors for appropriate uses and provide contrast-checked text/status tokens. Browser-composited contrast was not measured.

- **[low] [Modal.tsx:45](/home/arlavale/Meta/projects/gurps-calculator/src/components/ui/Modal.tsx:45), [ConfirmDialog.tsx:77](/home/arlavale/Meta/projects/gurps-calculator/src/components/ui/ConfirmDialog.tsx:77)** — The shared modal has focus trapping/restoration, but focusable selection does not exclude hidden descendants; confirmation descriptions use a fixed ID → filter visible focus targets and generate unique description IDs. Verify stacked dialogs and programmatic focus escape in a browser.

**15c status:** [UX_DESIGN_15C_PLAN.md:23](/home/arlavale/Meta/projects/gurps-calculator/docs/UX_DESIGN_15C_PLAN.md:23) proposed tokens → shared Modal → responsive layout. Tokens, the dev theme harness, and modal migration landed; 26 inspected files instantiate the shared Modal. Remaining fixed-inset elements are MapHeader click-catchers and the shared backdrop. Responsive auto-collapse/pinning and the wide character-sheet layout remain outstanding. Map combat already has optional dice/log disclosure, so progressive disclosure is partly present.

## 4. Refactor plan

Each phase should land independently. Network-dependent phases require the blocked suites to pass in a listening-capable environment.

| Phase | Goal and files touched | Risk | Proof | Size / parallelism |
|---|---|---|---|---|
| **1. Contract tests** | Add legacy/normalized save fixtures and workflow tests in persistence, export/import, Manager, combat, and App tests | Low | Reproduce identified defects; retain existing assertions | **M**; independent fixture lanes can parallelize |
| **2. Save recovery** | Fix storage decoding, backup/rollback, failed-load handling, atomic revision/save lifecycle in `persistence/`, `storage.ts`, App/store | High | Old campaigns retain content; corrupt/future saves cannot be overwritten; concurrent writes detected | **L**, after 1 |
| **3. Typed boundaries** | Introduce persisted DTOs, decoder/migrations, shared injury/template contracts, domain action unions | Med | Client/server typechecks; old-save round trips and action-routing tests | **M**, after 2 |
| **4. Import and visibility** | Repair Manager import/unlock; shared public projection; player API response schemas | High | Import changes state; unlock failures stay failures; normalized secrets absent everywhere public | **M**, after 3 |
| **5. Dead-code/tooling cleanup** | Remove verified obsolete implementations/tests; reconcile docs; repair ESLint/scripts; align React types | Low–med | Useful lint baseline, tests/typechecks green, entry-point reachability unchanged | **M**; parallel with 4 on disjoint files |
| **6. State ownership** | Delegate downtime actions; atomic inventory/config commands; extract store command modules/selectors | High | One operation/undo step; task resolution, external replacement, and time advancement tests | **L**, after 3–5 |
| **7. Combat consolidation** | Shared turn/maneuver/completion workflow for tracker/context; remove unused session implementation | High | Map and tracker parity, injury/resource sync, loot, journey resume, both undo paths | **L**, after 6 |
| **8. Multiplayer/desktop integration** | Wire App/SyncProvider/header; ordered sync and expected versions; shared protocol build; Electron packaging | High | Two-client tests, reconnect/stale-update tests, packaged desktop smoke test | **L**; desktop tooling can parallelize with 6–7 |
| **9. Screen decomposition** | Split UnifiedShell, MapPanel/MapScene responsibilities, fishing resolution, Manager navigation | Med | Existing behavioral tests pass through extracted boundaries; fresh bundle measurements | **L**, after relevant workflow phases |
| **10. UI foundation and overhaul** | Shared controls/tokens, semantic navigation, responsive layout, screen-by-screen adoption | Med | Keyboard checks, labeled controls, browser checks at 960/1280/1920, behavior tests | **L**; screen lanes parallelize after primitives stabilize |

Keep dependency major upgrades separate from structural and save-format changes.

## 5. UI primitives and design-system gaps

| Needed shared element | Existing implementations it should replace or absorb |
|---|---|
| **Button / IconButton** | Manager navigation/actions, TaskActions variants, character edit controls, map toolbar buttons, confirmation/footer buttons |
| **Field / TextInput / NumberInput / Select / TextArea** | CharacterSelector, DiceRoller total input, Manager forms, crafting/alchemy forms; centralize labels, hints, errors, disabled state |
| **Tabs / NavigationItem** | Manager tab strip, character pane switches, inventory view switches, combat setup/history controls |
| **Disclosure / Accordion** | TraitsSection, combat-history headers, reagent/detail cards, optional combat panels |
| **Panel / Card / SectionHeader** | Repeated bordered surfaces in Manager, downtime, crafting, character sheet, inventory |
| **StatusBadge / ResourceMeter** | Task status badges, conditions, participant HP bars, character resource displays |
| **DataTable / ScrollRegion** | Manager tables, character lists, inventory/recipe tables; headers, horizontal overflow, empty state |
| **Popover / Menu** | ConditionAddPopover, character context menu, MapHeader dropdowns; focus and dismissal conventions |
| **FormError / EmptyState / SaveStatus** | Inline validation, native alerts, ad hoc empty-state text, currently silent save failures |
| **Modal—extend existing** | Keep current shared primitive; strengthen hidden-element focus handling and unique descriptions |
| **ConfirmDialog / Toast / Tooltip—standardize existing** | Adopt shared variants, semantic warning tokens, consistent accessible behavior |

Tokens needed beyond existing color ramps:

- Semantic control variants: primary, secondary, destructive, warning, selected, disabled.
- Contrast-checked foreground/background pairs.
- Domain colors for alchemy, gathering, travel, and crafting.
- Density, spacing, control height, radius, border, typography, and focus-ring tokens.
- Layer/z-index conventions and responsive shell thresholds.
- Reduced-motion variants for urgency/pulse effects.

## 6. Do-not-break list

- **Existing saves:** legacy per-key data, normalized campaigns, current storage keys, and lazy localStorage → IndexedDB migration. Remove old bytes only after durable successful migration.
- **Round trips:** combat reveal Sets, map revealed-tile Sets, checkpoints, combat history, image assets, and inline-image migration.
- **Identity and ownership:** character/item/token IDs, inventory owners, equipped-item links, holdings quantities, deleted-builtin tombstones, and reference integrity.
- **Campaign progression:** calendar/slot semantics, time blockers, task assignments and ledgers, weather, meal buffs, crafting/alchemy progress, travel groups, vehicles, journeys, arrival and encounter interruption.
- **Combat:** initiative, condition timing/visibility, injury and persistent status, map-token movement, party HP/FP synchronization, summary/loot completion, and interrupted-journey resumption.
- **Undo/checkpoints:** data restoration, valid selections, preserved navigation state, retention limits, and deliberate separation of global and combat undo.
- **Exports/imports:** legacy envelopes, schema versions, encrypted GM payloads, asset bundles, size limits, and Set restoration. Correct the current secret exposure while preserving legitimate player data.
- **Network contracts:** campaign/session/asset endpoints, event names, GM authorization, campaign isolation, token expiry behavior, payload limits, and asset hashes.
- **Desktop:** context isolation, disabled Node integration, minimal preload exposure, user-data location, and server/client packaging paths.
- **UX:** character-pane navigation, dedicated combat entry, pending-intent handoffs, keyboard shortcuts, modal stacking/focus restoration, and usable narrow desktop layouts.