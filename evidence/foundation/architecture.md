# Foundation architecture evidence

Date: 2026-10-20. Scope: implementable architecture, public contracts and implementation handoff. These documents do not claim that the application, tests or benchmark results exist.

## Delivered artifacts

| Path | Purpose |
| --- | --- |
| `docs/architecture.md` | Frozen design choices, dependency graph, sparse state, calculation/grid/persistence mechanisms and compatibility limits |
| `docs/contracts.md` | Exact shared TypeScript declarations, package exports, Engine/registry signatures, worker protocol, HTTP schema and semantics |
| `docs/roadmap.md` | Dependency-ordered stages, exclusive owner scopes, root scripts, evidence gates and product traceability |
| `evidence/foundation/architecture.md` | Verification provenance, owned-resource receipts and bounded handoff |

The four documents already existed as untracked draft artifacts at this session's start. This pass read and completed them rather than treating the workspace as empty. Only these four paths were edited, using apply_patch. No application source, root configuration, lockfile, preserved input or commit was authored.

## Inspected inputs and baseline

Read all product requirements in `openexcellence-prompt`, all of `.omo/drafts/openexcel.md`, README, the three existing documents and existing evidence. The draft remains unfilled and is not an approved ulw-plan. Workspace inventory contained no application packages or root package manifest; the workspace AGENTS.md search returned no match.

Applicable guidance read: programming skill, its TypeScript and data-modeling references, and Bun execution guidance. User-required Node/npm/native SQLite/Vitest/Playwright override generic skill defaults. The first command observed Node `v24.21.0` and no `tsc` on PATH.

Preserved inputs at baseline:

```text
f778e2cce4298cd892717ec6fa7c09f2d40056d5a5ee9882a4727eecaa81e027  openexcellence-prompt
0866a30fec3e98a38bf78cf648f1347ce8362e7f58e7be1db7b369165bb85f41  .omo/drafts/openexcel.md
```

Initial git status was modified `openexcellence-prompt` plus untracked `.omo/`, `docs/` and `evidence/`. These pre-existing changes were not reverted or committed.

## Primary documentation rechecked

| Source identifier | Observed constraint | Design consequence |
| --- | --- | --- |
| Node official documentation, `nodejs.org/docs/latest-v24.x/api/sqlite.html` | DatabaseSync methods execute synchronously | Database connection and transactions belong to a Node worker |
| ExcelJS repository, `exceljs/exceljs`, README formula-value section, via Context7 | Caller supplies formula results; file adapter does not calculate them | Custom engine computes the export cache; interop only consumes it |
| Vite repository, `vitejs/vite`, `docs/guide/features.md`, via Context7 | Worker URL constructor must be directly nested in new Worker with static options | WEB owns a statically bundled module-worker entry |
| Zod repository, `colinhacks/zod`, `packages/docs/content/api.mdx`, via Context7 | Branded output is `T & z.$brand<Tag>` | Model declares Zod 4-compatible nominal IDs |

Chart/pivot support beyond the base adapter is explicitly owned OOXML implementation work, not assumed library fidelity. Old draft source claims and temporary-root receipts were not reused as evidence for this session.

## Decisions and corrected integration gaps

* Sparse serializable 128-by-32 tiles retain authored cells only; arrays/caches/spill children remain derived. Dense grid allocation is rejected.
* MODEL is the dependency root. FORMAT imports MODEL; FORMULA imports MODEL/FORMAT; DATA imports MODEL/FORMULA; INTEROP imports MODEL; SERVER/WEB are leaves. Callback readers avoid a formatting-to-formula cycle.
* One owner per package and exact non-wildcard export paths are frozen. Root lockfile/configuration belong only to FOUNDATION.
* DOM virtualization uses logical full-grid coordinates, bounded physical scroll surfaces and a real accessible editable overlay. Canvas plus a duplicate accessibility tree is not selected.
* Engine construction/set/evaluate/recalculate, scratch-vs-published caches, forks, history recovery and structural transformation of chart/pivot/name/table references are explicit.
* LET/LAMBDA and lazy branching have exact registry contexts; array branch masks prevent unselected errors. Synchronous callbacks have honest cancellation boundaries and a worker-termination recovery path.
* Copy/paste/find/duplicate queries have actual worker messages. Projection ordering includes epoch as well as revision; clipboard cuts guard the captured source revision.
* Save uses transactional optimistic versions and idempotent canonical-payload receipts. Exports recompute with an explicit frozen clock/seed and never trust uploaded calculation caches.
* Assumptions: local single-user deployment, invariant English/en-US formula syntax, UTC calculation clock, IEEE-754 numbers, 1900/1904 serial dates. Optional rich-text editing and non-native XLSX features have visible compatibility limits, not hidden implementation waivers.

## Verification ledger

| Check | Observed result |
| --- | --- |
| Declaration assembly | Every TypeScript fence has a module marker; same-module fences concatenate into 11 modules |
| Strict semantic compilation | TypeScript 5.9.3 and real Zod 4.3.6, all 11 declaration modules: 0 diagnostics, exit 0 |
| Compiler options | strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, noFallthroughCasesInSwitch; noEmit; library checking enabled |
| Package dependency graph | Seven packages/apps, acyclic; legal order model, formatting/interop, formula, data/server, web |
| Public import paths | Every documented workspace import resolves to a declared entry; no illegal cross-package edge |
| Ownership | Seven package/app scopes, seven unique owners; no shared package write scope |
| Function coverage | All 88 names in the product's required list appear in the required compatibility matrix; zero missing |
| Root script coverage | dev, test, typecheck, build, test:e2e, benchmark and samples all have exact dispatch and responsibilities |
| Final contract reread | Declarations remain identical to the successful compiler input after the final semantic prose clarifications |
| Document hygiene | All four documents have balanced code fences and no trailing whitespace |
| Preserved-file verification | Final SHA-256 values exactly match both baseline hashes above |
| Cleanup verification | All previous owned command roots were absent; final command removed its own root with exit 0 |

The first isolated compiler run returned three diagnostics because the temporary verification host resolved Zod's relative imports from the wrong containing directory. Correcting that host and rerunning with unchanged declarations returned zero diagnostics. No errors were suppressed and no substitute Zod declaration was used.

The compiler operated on virtual declaration files assembled in memory from the documents; no verification source or dependency was added to the repository. This proves declaration/import consistency, not implementation behavior. Application build, Vitest, Playwright and benchmarks were not run: application manifests/source were absent at the inspected foundation baseline and are outside this scoped task. The roadmap makes their actual execution mandatory downstream.

Markdown LSP diagnostics were unavailable because no `.md` language server is configured; no out-of-scope LSP configuration was added. The real TypeScript compiler checked the declarations instead. Repository-wide `git diff --check` reported pre-existing whitespace on protected `openexcellence-prompt:3` and exited 2. That input was deliberately preserved, and the four scoped documents passed the independent whitespace scan. A subsequent status showed a new untracked `tests/` directory from concurrent workspace work; it was not inspected, edited or attributed to this task.

## Owned-resource receipts

Every shell command allocated its own mktemp root and placed TMPDIR, NODE_COMPILE_CACHE and BUN_RUNTIME_TRANSPILER_CACHE_PATH beneath it. Compiler runs also isolated npm cache/toolchain downloads; their EXIT traps removed the entire owned root. No server, browser or database was launched.

| Command | Owned root | Receipt |
| --- | --- | --- |
| Baseline status/hash/runtime probe | `/tmp/tmp.MgMd7PEflD` | removed=yes, exit=0 |
| Initial compiler host | `/tmp/tmp.HigK6z9d2q` | removed=yes, exit=1; harness resolution defect described above |
| Corrected strict compilation | `/tmp/tmp.uSaSvwkdY2` | removed=yes, exit=0; 11 modules, 0 diagnostics |
| Repository-wide whitespace probe | `/tmp/tmp.pqgKVT76LD` | removed=yes, exit=2; pre-existing protected prompt finding |
| Final hash/status/cleanup check | `/tmp/tmp.0QpsYH6J0F` | removed=yes, exit=0; preserved hashes match, earlier roots absent |

## Bounded handoff

Owner: DOCUMENTATION. Deliverables: the four paths above. No unresolved package owner, public import, Engine/registry signature, worker operation, API endpoint or root-script choice remains.

The lead can assign FOUNDATION F0 and MODEL M1, then fan out FORMAT/INTEROP and FORMULA syntax after the shared model gate. FORMULA completion unlocks DATA and SERVER; WEB remains the sole web writer throughout its staged integration. Root configuration/lockfile and verified commits remain the lead's responsibility. Each owner hands back at most 30 lines with implemented exports, real checks, incomplete behavior and cleanup receipts.

Next evidence is implementation evidence: model/schema tests, formula compatibility fixtures, persistence and real-browser integration, then the challenge workbook and measured performance. None is represented as already complete by this foundation.

## Final check record

Date: 2026-10-20.

* `git diff --check`: failed; reported pre-existing trailing whitespace at `openexcellence-prompt:3`. The file is outside the permitted edit scope and was not changed.
* Required documents: `docs/architecture.md`, `docs/contracts.md`, `docs/roadmap.md` and `evidence/foundation/architecture.md` all exist.
* `sha256sum openexcellence-prompt`: `f778e2cce4298cd892717ec6fa7c09f2d40056d5a5ee9882a4727eecaa81e027` (matches required hash).
* `sha256sum .omo/drafts/openexcel.md`: `0866a30fec3e98a38bf78cf648f1347ce8362e7f58e7be1db7b369165bb85f41` (matches required hash).

## Bounded recovery finalization

On 2026-10-20, reread all four existing documents and performed one bounded in-memory consistency check. Result: 11 declaration modules; all workspace imports resolve within the documented acyclic seven-node dependency graph; seven exclusive package/app owner scopes; all seven required root scripts; 88 distinct function names in the compatibility matrix; balanced code fences and no trailing whitespace in the four documents. No inconsistency was found within this check.

Only this evidence file changed during recovery. The design was not revised, no external research or shell command ran, and no temporary resources were created. Earlier compiler, hash and cleanup results above remain historical evidence; they were not rerun or presented as new recovery results. No application runtime verification or commit was performed. Recovery is complete.
