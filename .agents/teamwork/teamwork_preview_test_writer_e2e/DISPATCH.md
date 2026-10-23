# DISPATCH: test_writer_e2e

- **Role**: Requirement-Driven E2E Test Writer
- **Archetype**: teamwork_preview_test_writer
- **Working Directory**: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_test_writer_e2e
- **Parent Conversation ID**: 15f3305d-1fad-4e14-a468-1ad8e746bf0d
- **Authoritative Request**: /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md
- **Test Infra Document**: /workspaces/excellence-chart/TEST_INFRA.md
- **Project Document**: /workspaces/excellence-chart/PROJECT.md

## Exclusive File Ownership
- `tests/integration/` (e.g. `tests/integration/pipeline.test.ts`)
- `tests/e2e/interactions.spec.ts`
- `/workspaces/excellence-chart/TEST_READY.md`

DO NOT modify source code files in `apps/` or `packages/`.

## Mission & Instructions
1. Read `/workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md` and `/workspaces/excellence-chart/TEST_INFRA.md`.
2. Construct comprehensive requirement-driven integration tests in `tests/integration/pipeline.test.ts` covering:
   - Full pipeline: Workbook creation -> Tile storage -> Formula evaluation (cross-sheet, circular detection `#CIRC!`, dynamic spill `#SPILL!`) -> Cell formatting application -> AutoFilter hidden rows & sorting -> Pivot table aggregation -> XLSX export & SHA-256 manifest verification -> SQLite WAL save & reload.
3. Construct interactive Playwright E2E tests in `tests/e2e/interactions.spec.ts` covering:
   - Cell selection & navigation.
   - Formula bar input and recalculation.
   - Chart reactivity.
   - Find & Replace functionality.
4. Run `npm test` to ensure new integration tests pass with 100% success.
5. Create `/workspaces/excellence-chart/TEST_READY.md` following the template in `TEST_INFRA.md` and report back.
6. Write your handoff report to:
   `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_test_writer_e2e/handoff.md`.

## 2026-10-23T06:11:09Z
You are test_writer_e2e, a test writer subagent (teamwork_preview_test_writer).
Your working directory is: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_test_writer_e2e
Your parent is: 15f3305d-1fad-4e14-a468-1ad8e746bf0d
Authoritative request: /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md
Test Infra specification: /workspaces/excellence-chart/TEST_INFRA.md
Project specification: /workspaces/excellence-chart/PROJECT.md
Dispatch instructions: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_test_writer_e2e/DISPATCH.md

You exclusively own these files:
- tests/integration/ (e.g., tests/integration/pipeline.test.ts)
- tests/e2e/interactions.spec.ts
- /workspaces/excellence-chart/TEST_READY.md

Task:
1. Read /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md and /workspaces/excellence-chart/TEST_INFRA.md.
2. Build comprehensive integration tests in tests/integration/pipeline.test.ts verifying:
   - Full pipeline: Workbook creation -> Tile storage -> Formula evaluation (cross-sheet references, cycle detection #CIRC!, dynamic array spill #SPILL!) -> Formatting -> AutoFilter hidden rows & sort -> Pivot table aggregation -> Lossless XLSX export with SHA-256 manifest -> SQLite WAL save & reload.
3. Build E2E tests in tests/e2e/interactions.spec.ts for UI interactions (cell selection, editing, formula recalculation, chart updates).
4. Run npm test to verify all tests pass.
5. Create /workspaces/excellence-chart/TEST_READY.md summarizing test counts across Tier 1, Tier 2, Tier 3, and Tier 4.
6. Write your handoff report to: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_test_writer_e2e/handoff.md
7. Send a message back to parent 15f3305d-1fad-4e14-a468-1ad8e746bf0d.
