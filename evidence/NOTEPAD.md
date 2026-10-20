# Ultrawork Notepad — Build and verify OpenExcel
Started: 2026-10-19T22:03:43Z. Recovered: 2026-10-20T05:26Z.

## Plan (exhaustively detailed)
1. Inspect workspace, skills, memory and history. Completed: empty application repository, user prompt and draft preserved.
2. Register full OpenExcel goal and resource/notepad tracking. Completed; goal remains active.
3. Foundation phase DAG: architecture contracts -> scaffold/install -> independent verification.
4. Core phase DAG: sparse model/types/history -> independent formatting, formula syntax, interoperability; functions and engine follow their required contracts; independent real-command verification gates.
5. Application phase DAG: data planners/charts projection, Node/SQLite backend and browser UI in disjoint scopes, then worker/UI integration and real tests.
6. Acceptance phase DAG: challenge workbook/sample regression, Playwright workflows, benchmark harness, deployment/documentation; independent verification gates.
7. Lead runs actual HTTP and browser desktop/mobile editing, formulas, formatting, live charts, persistence and XLSX round trip. Capture action log/screenshots.
8. Measure 100K/1M storage and 100K dependent formulas with raw evidence; audit security and complete feature status.
9. Re-read diff and diagnostics, fix regressions, record self-review. Commit verified increments only. No ulw-plan requested; no plan-reviewer gate.
10. Tear down owned servers/browsers/caches with read-back receipts. Report actual deliverables, tests, performance and remaining limitations. Do not claim mission complete while requested features remain incomplete.

## Success criteria + QA scenarios
Binding full objective is registered through create_goal. HEAVY: new architecture, untrusted file parsing, transactional persistence and workers.
1. `npm run test`, `npm run typecheck`, `npm run build`: exit 0, actual unit/integration/property evidence in evidence/checks.
2. `npm run test:e2e`: real create/edit SUM(10,20)=30 then 15+20=35; formatting/chart live update; save/reload; XLSX export/import; malformed input and navigation edges. Retain screenshots/actions.
3. `npm run benchmark`: measured 100K/1M sparse storage/load and 100K dependent formulas with hardware, raw timing/memory and documented failures.
4. `npm run samples`: Excel_Compatibility_Challenge.xlsx with finance/cross-sheet/arrays/lookups/formats/pivots/charts/dates/nested formulas/errors/cycles; supported regression expectations pass, losses explicit.
5. Lead omowright browser QA desktop/mobile, HTTP status/headers/body trust-boundary checks, complete honest feature status/matrix and startup/Docker docs.
Stop only when full requested behavior is proven, requested capabilities accounted for truthfully, cleanup receipts retained and final delivered; concrete environmental limits require evidence, not a fabricated completion.

## Now
Recover interrupted foundation DAG, preserving already authored docs.

## Todo
Live todo has 2/28 complete: discovery and registered goal/notepad. Architecture in progress. All core/UI/service/data/integration/verification/delivery tasks remain open.
Owned run root and runtime caches require cleanup. Durable notepad is retained evidence.

## Findings
- Repository HEAD c67f460, no application code at initial inspection. Node 24.21.0 and Bun 1.4.3.
- Preserve modified openexcellence-prompt and .omo/drafts/openexcel.md. Draft is empty scaffolding, not an approved plan.
- Original notepad `/tmp/ulw-20261019-220343.LqzL47.md` and root `/tmp/tmp.C0pNTp12KW` disappeared in environment restart; read returned ENOENT. Recover durable notes here, do not depend on /tmp surviving.
- Current owned run root `/tmp/tmp.vD79iNDIJV`; commands export TMPDIR and both runtime cache paths beneath it.
- Foundation run `dag_fbc039df-7325-4640-a8a8-a68960653f9d`: existing docs/architecture.md, docs/contracts.md, docs/roadmap.md and evidence/foundation/architecture.md survived. Architecture report still had pending final verification; source scaffold did not exist at recovery.
- Recovered child st_01a15633 was error/nonresident while journal said running. Send returned node_not_continuable; retry returned run_still_active. Settled orphan with cancel and retried the same phase run; steered architecture to verify existing docs and return without redesign.
- Canonical contract uses sparse 128x32 tiles, branded IDs, immutable workbook/transactions, model/API schemas; formula functions and syntax subpaths; formatting breaks formula cycle via readers; data -> formula; interop -> model only; Node native SQLite and DOM virtualization.
- Read contracts.md lines 1-980 and roadmap.md in full. Architecture doc and remaining API/worker contracts still need lead read before consumer integration.
- Skills used/read: mass-ulw plus full planning reference; bun-1-4; programming and TypeScript reference; browser plus owned-engine reference; frontend/visual-qa routers. Delegated owners read applicable workflow bodies. User explicitly requires Node stack, overriding skill runtime preferences.
- Browser engine env was unset; no chromium command on PATH. Owned omowright profile is appropriate for this unauthenticated local app. Install/check browser after toolchain exists.
- Independent session search found only this project session. Memory had no project facts initially; mission recorded via memory tool.

## Learnings
- Phase DAGs, not one giant graph. Each phase has producer-owned tests and a verification node; root independently verifies claims.
- Full objective persists through restarts; no narrowing to a demo or silently waived capabilities.
- Keep handoff evidence in repository, not only ephemeral /tmp.

## Now — recovery transition
Foundation run resumed in place; architecture finishing its bounded final pass. Scaffold and verification follow automatically. Lead prepares explicit producer lanes from concrete contracts.

## Findings — acceptance coverage ledger
Created docs/implementation-status.md as an exhaustive native-feature and delivery ledger, including every required function name, all nine chart kinds and all 20 UI requirements. Everything unimplemented stays explicitly Pending. Architecture is design evidence only, not functional acceptance. Read remaining contracts.md lines 981-1227 and architecture.md in full: exact API/worker/storage guarantees now known.
## Now — foundation pending
Recovered DAG is active with architecture running; no implementation files exist yet. Await its terminal handoff before starting dependent core producers. Documentation ledger is independent root work and does not alter producer-owned foundation docs.

## Plan addition — independent formula oracle
Lead owns tests/compatibility/**, separate from package producers. Author independently worked ordinary and edge examples for every required function, then a real Engine-based Vitest runner after model/formula APIs exist. Scenario: `npm run test -- tests/compatibility/functions.test.ts`; PASS requires actual values/errors/array shapes against literals, no expected value derived from tested functions. Pending until the engine is implemented and the runner passes.
## Now — independent fixture authoring
Added tests/compatibility/function-cases.ts with scalar, error, dynamic-array and seeded-clock examples. These are unrun oracle data, NOT passing tests or evidence of implemented functions. The function registry/engine owners must supplement argument/coercion/error semantics and do not edit these independent expected values to match broken behavior.

## Findings — foundation route failure
Recovered architecture child st_01a157c6 stopped answering (three missed heartbeats); no final verification was written. Reviewed its report and preserved hashes again. Amended same DAG architecture node to quick with a frozen read-only design and append-only concrete final evidence check, preserving downstream scaffold/verification. No redesign or external research needed.
## Findings — independent runner authored
tests/compatibility/functions.test.ts now drives actual Engine.create/evaluateFormula against the oracle data with fixed epoch, real sparse model/registry, precise errors/array shapes, and invalid arity dispatch. Not run: workspace dependencies and implementations still absent. Do not mark oracle task complete until actual execution passes.
## Findings — unavailable LSP
Editing TypeScript triggered "typescript-language-server NOT INSTALLED". This is tooling absence, not a source diagnostic. Toolchain owner should install typescript-language-server with TypeScript during authorized workspace setup; use compiler diagnostics until server is available.

## Plan change — direct foundation implementation
Scaffold st_01a157d1 failed with three missed heartbeats before creating files. Lead takes root/configuration implementation back; no active producer owns these paths now. Created actual workspace manifests, strict project references, Vitest/root-test inclusion, Vite configuration, Node dev supervisor and resource-isolated script dispatcher. No application source stub was added. Root scripts require the forthcoming real packages and are not yet claimed green.
Foundation verification will be amended to inspect/run the lead-owned scaffold, rather than launch another broad setup lane.

## Findings — installed foundation and audit
Initial npm install exited 0. Actual probes: TypeScript 5.9.3, Vitest 3.2.4, Playwright 1.55.1; native Node DatabaseSync in-memory SELECT returned {ok:1}; bash -n scripts/run.sh and node --check scripts/dev.mjs passed.
`npm audit --json` caught seven vulnerable dependency entries (including critical Vitest/tinypool and high Vite; moderate fflate and ExcelJS's UUID). This check prevented shipping the initial pins. Updated to registry-verified Vitest 5.0.5, Vite 7.3.7, fflate 0.8.3; override ExcelJS's UUID to 11.1.1 after reading its sole usage (CommonJS named v4). Must verify real XLSX conditional-format serialization and rerun audit. Added local Biome/bash LSPs for missing diagnostics, not global tooling.
Primary advisory verification: Vitest GHSA-82fw-gwwq-j7x9 (upstream security advisory); registry peer ranges confirm Vitest 5.0.5 supports Node24/Vite7 and React plugin4.7 supports Vite7.

## Now — model phase active
Run dag_e516d84c-bc4d-428c-ae80-3df61796cae9: model producer -> independent model verifier. Initial unspecified-high route had no connected provider (plan_unresolved) before task execution. Amended same run to available deep-low, unchanged scope. Root owns dependency remediation and foundation verification; model lane owns only model/src, model/test and its report.
