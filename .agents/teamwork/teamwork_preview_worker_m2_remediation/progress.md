# Progress — worker_m2_remediation

Last visited: 2026-10-23T07:16:30Z

## Status
- [x] Read DISPATCH.md, reviewer handoff, challenger handoffs
- [x] Investigated codebase and verified reproductions of all reported defects
- [x] Designed coordinate-aware formula reference translation and App.tsx visual drag resize
- [x] Implement changes in apps/web/src/operations.ts
  - Fix tile column divisor: Math.floor(c / TILE_COLUMNS) with TILE_COLUMNS = 32
  - Implement coordinate-aware formula reference translation across all sheet cells on insertRow, deleteRow, insertColumn, deleteColumn
  - Added boundary clamping for shifted merge rectangles
- [x] Implement changes in apps/web/src/App.tsx
  - Added colVisualResize and rowVisualResize states to update visual layout during drag resize mousemove without transactions
  - Defer commit to history.record on mouseup
  - Added replacer function in Find & Replace to avoid regex capture group expansion with $
- [x] Verify with test scripts and full test suite:
  - npm run typecheck: PASS
  - npm test: PASS (12 files, 418 tests)
  - npm run build: PASS (client build in 2.26s)
  - npm run test:e2e: PASS (8 tests in 27.1s)
  - Reproduction 1: Column 32 cell preserved after insertRow (PASS)
  - Reproduction 2: Unrelated row delete preserves =A1*100 (PASS)
  - Reproduction 3: Deleted row turns =A2 into =#REF! (PASS)
  - Reproduction 4: Drag resize history preservation (PASS)
- [x] Write handoff.md
- [ ] Send completion message to parent
