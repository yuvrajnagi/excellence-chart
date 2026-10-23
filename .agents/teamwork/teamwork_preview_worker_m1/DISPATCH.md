# DISPATCH: worker_m1

- **Role**: Persistence & E2E Stability Worker
- **Archetype**: teamwork_preview_worker
- **Working Directory**: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m1
- **Parent Conversation ID**: 15f3305d-1fad-4e14-a468-1ad8e746bf0d
- **Authoritative Request**: /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md
- **Project Scope Document**: /workspaces/excellence-chart/PROJECT.md

## Exclusive File Ownership
- `apps/server/src/app.ts`
- `apps/web/src/App.tsx`

DO NOT modify files outside your ownership boundary.

## Context & Task
Survey reports from `explorer_survey_1` and `explorer_survey_3` identified the exact root cause of the 2 failing Playwright E2E tests:
1. In `apps/server/src/app.ts` (around line 32), when `data.kind === 'snapshot'` is posted, the server creates a new ID `id: createId('workbook')` rather than preserving `data.workbook.id`.
   Fix:
   ```ts
   const workbook = data.kind === 'blank'
     ? createWorkbook({id: createId('workbook'), sheetId: createId('sheet'), name: data.name, timestamp: new Date().toISOString()})
     : { ...data.workbook, id: data.workbook.id ?? createId('workbook'), properties: { ...data.workbook.properties, name: data.name } };
   ```
2. In `apps/web/src/App.tsx` (around line 52), when `createWorkbook` returns, update local workbook reference and localStorage:
   ```ts
   if ('workbook' in response) {
     current.current = response.workbook;
     setWorkbook(response.workbook);
     localStorage.setItem('openexcel-last', response.workbook.id);
   } else {
     localStorage.setItem('openexcel-last', snapshot.id);
   }
   ```
   Reference patch at: `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_survey_3/e2e_persistence_fix.patch`.

3. After applying this fix:
   - Run `npm run typecheck`
   - Run `npm test`
   - Run `npm run test:e2e`
   - Run `npm run build`
4. Document all changes, commands run, and pass/fail outputs in:
   `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m1/handoff.md`

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.


## 2026-10-23T06:11:09Z
[Message] timestamp=2026-10-23T06:11:09Z sender=15f3305d-1fad-4e14-a468-1ad8e746bf0d priority=MESSAGE_PRIORITY_HIGH content=You are worker_m1, a worker subagent (teamwork_preview_worker).
Your working directory is: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m1
Your parent is: 15f3305d-1fad-4e14-a468-1ad8e746bf0d
Authoritative request: /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md
Project specification: /workspaces/excellence-chart/PROJECT.md
Dispatch instructions: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m1/DISPATCH.md

You exclusively own these files:
- apps/server/src/app.ts
- apps/web/src/App.tsx

Task:
1. Read /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md and PROJECT.md.
2. In apps/server/src/app.ts (around line 32), preserve data.workbook.id when data.kind === 'snapshot' instead of creating a new random ID:
   const workbook = data.kind === 'blank'
     ? createWorkbook({id: createId('workbook'), sheetId: createId('sheet'), name: data.name, timestamp: new Date().toISOString()})
     : { ...data.workbook, id: data.workbook.id ?? createId('workbook'), properties: { ...data.workbook.properties, name: data.name } };
3. In apps/web/src/App.tsx (around line 52), update local current reference and localStorage with response.workbook:
   if ('workbook' in response) {
     current.current = response.workbook;
     setWorkbook(response.workbook);
     localStorage.setItem('openexcel-last', response.workbook.id);
   } else {
     localStorage.setItem('openexcel-last', snapshot.id);
   }
4. Run build and tests:
   - npm run typecheck
   - npm test
   - npm run build
   - npm run test:e2e (verify performance.spec.ts, workbook.spec.ts all pass!)
5. Write your handoff report to: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m1/handoff.md
6. Send a message back to parent 15f3305d-1fad-4e14-a468-1ad8e746bf0d with your report.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
