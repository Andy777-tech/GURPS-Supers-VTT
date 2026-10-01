# Deep review: GURPS VTT before a refactor + UI/UX overhaul

**Mode:** READ-ONLY. Do not edit, create, or delete any file. Do not run `npm install`. You may run read-only commands (`rg`, `git log`, `npx tsc --noEmit`, `npx vitest run`, `npx eslint`, `graphify query|explain|path`).

## Context

This is one of the owner's oldest projects: a GURPS 4e campaign manager (React 18 + TS strict + Tailwind + Vite, Electron shell, Express/Socket.io/sql.js server). It grew phase by phase (see `ROADMAP.md`, `PROJECT_STATUS.md`, `docs/*_PLAN.md`). The owner wants a real refactor now, followed by a UI/UX overhaul. Your review is the input to both: Claude will write the refactor code from your findings, and you (or another Codex run) will review that code afterward.

Conventions the codebase claims to follow are in `AGENTS.md` and `.agents/skills/vtt-resume/`. Check whether the code actually follows them — do not assume.

A graphify knowledge graph exists at `graphify-out/` (`graphify query "<q>"`, `graphify explain "<symbol>"`). `graphify-out/GRAPH_REPORT.md` lists god nodes; use it to find high-blast-radius code instead of reading everything linearly.

## What to review

Cover each area. For every finding give: severity (high/med/low), `file:line` anchors, what is wrong, why it matters for a refactor, and the concrete fix shape.

1. **Architecture and state.** `src/state/campaignReducer.ts`, `campaignStore.tsx`, the domain reducers and their delegation guards, selectors. Look for: god reducers/components, logic in components that belongs in reducers/utils, duplicated state, derived state stored instead of selected, leftover bridge contexts (`CombatContext` etc.), circular imports, action-type sprawl.
2. **Type safety.** Count `as any`, `@ts-ignore`, `@ts-expect-error`, non-null `!` hotspots; identify the type definitions whose looseness causes most of them. Run `npx tsc --noEmit` and report the result.
3. **Dead and duplicated code.** Unused exports/files/components, parallel implementations of the same thing (e.g. two ways to compute a stat, two inventory models), stale `docs/` and root markdown files (`spec.md`, `todo.md`, `AUTO_QUEUE.md`, `AUTO_REVIEW.md`, `KNOWN_ISSUES.md`, `gurps-vtt-resume.skill`, `docs/alchemy-logic.js`) that no longer describe the code.
4. **Persistence and schema.** `src/persistence/`: versioning, migrations, round-trip safety, what breaks if state shape changes during the refactor. This is the main risk to the owner's saved campaigns — say exactly what a refactor must not break.
5. **Tests.** Run `npx vitest run` (full suite is fine on this machine, ~11 s) and `server/` tests with their own config. Report pass/fail counts, coverage gaps on the code most likely to be touched by the refactor, and tests that test implementation details and will break needlessly.
6. **Server / multiplayer / Electron.** `server/src/`, `shared/`, `src/net/`, `electron/`: auth state, input validation, IPC exposure in preload, protocol drift between client and server.
7. **Build and dependencies.** `package.json` (root + server), vite/electron-builder config, outdated or unused deps, bundle size hotspots (three.js etc.), lint config health (`npx eslint .` summary counts only).
8. **UI/UX inventory (input to the overhaul, not a redesign).** Map the app's navigation structure (tabs, routes, modals), list the top-level screens and how a user moves between them, and report: inconsistent styling (ad-hoc colors/spacing vs Tailwind theme tokens in `tailwind.config.js`), duplicated UI primitives (buttons, modals, inputs implemented more than once vs `src/components/ui/`), accessibility gaps (missing labels, non-button clickables, focus handling, contrast), and screens that are overloaded. Note what `docs/UX_DESIGN_15C_PLAN.md` already proposed and whether any of it landed.

## Deliverable

Your final message is the review, in Markdown, with these sections in order:

1. **Summary** — 10 lines max: overall health, the 5 most important findings.
2. **Verification results** — tsc, vitest (client + server), eslint counts, exact commands run.
3. **Findings by area** — sections 1–8 above, each finding as `- [sev] file:line — problem → fix shape`.
4. **Refactor plan** — ordered phases, each one landable on its own with tests green: goal, files touched, risk, what proves it worked, rough size (S/M/L). Put persistence-safe groundwork (types, tests, dead-code removal) before structural moves. Mark which phases can run in parallel.
5. **UI primitives and design-system gaps** — the concrete list of shared components and tokens the overhaul will need, with which existing components each would replace.
6. **Do-not-break list** — behaviors, save formats and APIs the refactor must preserve.

Be specific and evidence-backed. Prefer fewer, verified findings over a long speculative list; label anything unverified as such.
