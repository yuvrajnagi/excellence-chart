# DISPATCH: worker_m2

- **Role**: UI Interactions & Grid Completeness Worker
- **Archetype**: teamwork_preview_worker
- **Working Directory**: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m2
- **Parent Conversation ID**: 15f3305d-1fad-4e14-a468-1ad8e746bf0d
- **Authoritative Request**: /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md
- **Project Specification**: /workspaces/excellence-chart/PROJECT.md
- **UI Architecture Reference**: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_survey_1/handoff.md

## Exclusive File Ownership
- `apps/web/src/operations.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`

DO NOT modify files outside your exclusive ownership boundary.

## Mission & Instructions
Implement Requirement R1 UI features and UX enhancements in OpenExcel:

1. **Row & Column Insert/Delete**:
   - In `apps/web/src/operations.ts`, implement:
     - `insertRow(workbook: Workbook, sheetId: string, rowIndex: number, count?: number): Workbook`
       - Shifts all cells with `row >= rowIndex` down by `count`.
       - Adjusts formula references via `adjustFormulaReferences(formula, count, 0)` for cells below `rowIndex`.
       - Updates rowInfo and merges.
     - `deleteRow(workbook: Workbook, sheetId: string, rowIndex: number, count?: number): Workbook`
       - Removes cells in `rowIndex .. rowIndex + count - 1`.
       - Shifts subsequent cells up by `count`.
       - Updates rowInfo and merges.
     - `insertColumn(workbook: Workbook, sheetId: string, colIndex: number, count?: number): Workbook`
     - `deleteColumn(workbook: Workbook, sheetId: string, colIndex: number, count?: number): Workbook`
   - In `apps/web/src/App.tsx`:
     - Expose "Insert Row", "Delete Row", "Insert Column", "Delete Column" in Ribbon toolbar and context menus.
     - Support Column Hide and Unhide in View tab and context menus.

2. **Header Drag Resize & Whole Row/Col Selection**:
   - Mouse drag handles on `.oe-col` right edge and `.oe-row` bottom edge to interactively resize column widths and row heights.
   - Clicking column header selects column `0..1048575`.
   - Clicking row header selects row `0..16383`.
   - Clicking corner selects the entire sheet.
   - Right-click on headers opens header context menu with Insert, Delete, Hide, Unhide, and Resize options.

3. **Interactive Find & Replace Dialog**:
   - Replace modal `prompt()` calls with an interactive floating dialog in `App.tsx`:
     - Inputs: Find text, Replace text, checkboxes: Match Case, Match Entire Cell.
     - Buttons: "Find Next", "Find Previous", "Replace", "Replace All", "Close".
     - "Find Next" / "Find Previous" scrolls viewport and moves selection to highlight matching cells across the sheet.

4. **Sheet Tabs Management**:
   - Add tab reordering buttons/actions ("Move Left", "Move Right") to reorder `workbook.sheetOrder`.
   - Add Tab Color picker in tab bar/context menu to customize `sheet.properties.tabColor`.

5. **Selection & Fill Handle Placement UX**:
   - Anchor the fill handle `.oe-fill` to the bottom-right corner of the multi-cell selection bounding box rather than strictly inside the active cell element.

6. **In-Flight Save Race Mitigation**:
   - In `App.tsx:52`, update workbook reference without erasing newer in-memory edits:
     ```ts
     if ('workbook' in response) {
       localStorage.setItem('openexcel-last', response.workbook.id);
       if (current.current.id !== response.workbook.id) {
         current.current = { ...current.current, id: response.workbook.id };
         setWorkbook(current.current);
       }
     }
     ```

7. **Verification**:
   - Run `npm run typecheck`
   - Run `npm test`
   - Run `npm run build`
   - Run `npm run test:e2e` (ensure all 8 tests continue to pass and new features are functional)
8. Document all changes and verification outputs in `/workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m2/handoff.md`.

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## 2026-10-23T06:32:43Z
[Message] timestamp=2026-10-23T06:32:43Z sender=15f3305d-1fad-4e14-a468-1ad8e746bf0d priority=MESSAGE_PRIORITY_HIGH content=You are worker_m2, a worker subagent (teamwork_preview_worker).
Your working directory is: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m2
Your parent is: 15f3305d-1fad-4e14-a468-1ad8e746bf0d
Authoritative request: /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md
Project specification: /workspaces/excellence-chart/PROJECT.md
UI Architecture reference: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_explorer_survey_1/handoff.md
Dispatch instructions: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m2/DISPATCH.md

You exclusively own these files:
- apps/web/src/operations.ts
- apps/web/src/App.tsx
- apps/web/src/styles.css

Task:
1. Read /workspaces/excellence-chart/.agents/teamwork/ORIGINAL_REQUEST.md and PROJECT.md.
2. Implement Row & Column Insert/Delete:
   - In operations.ts: implement insertRow, deleteRow, insertColumn, deleteColumn with formula reference adjustments via adjustFormulaReferences.
   - In App.tsx: wire Insert/Delete row/column into Ribbon and context menus; support column hide/unhide.
3. Implement Header Drag Resize & Whole Row/Col Selection:
   - Mouse drag handles on column header right edge and row header bottom edge to resize sizes.
   - Click column/row/corner header to select whole column (0..1048575), row (0..16383), or sheet.
   - Header right-click context menu.
4. Implement Interactive Find & Replace Dialog:
   - Replace modal prompt() with an interactive floating dialog in App.tsx with Find, Replace, Match Case, Match Entire Cell, Find Next, Find Previous, Replace, Replace All.
5. Sheet Tabs:
   - Add tab reordering (Move Left, Move Right).
   - Add tab color picker in tab bar/context menu.
6. UX fixes:
   - Anchor fill handle to bottom-right corner of selection bounding box.
   - Mitigate in-flight save race in App.tsx:52.
7. Verification:
   - npm run typecheck
   - npm test
   - npm run build
   - npm run test:e2e
8. Write handoff report to: /workspaces/excellence-chart/.agents/teamwork/teamwork_preview_worker_m2/handoff.md
9. Send completion message back to parent 15f3305d-1fad-4e14-a468-1ad8e746bf0d.

