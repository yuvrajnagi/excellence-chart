import type { CellAddress, CellRect, CellStyle, SheetId, Workbook, Scalar, Cell, Patch, Commit } from '@openexcel/model';

export type EditMode = 'view' | 'edit' | 'formula';
export type RibbonTab = 'file' | 'home' | 'insert' | 'formulas' | 'data' | 'review' | 'view';

export interface SelectionState {
  active: { row: number; col: number };
  ranges: CellRect[];
  selecting: boolean;
  anchor: { row: number; col: number } | null;
}

export interface ClipboardState {
  mode: 'copy' | 'cut' | null;
  sheetId: SheetId | null;
  range: CellRect | null;
}

export interface UIState {
  activeTab: RibbonTab;
  zoom: number;
  showGridlines: boolean;
  showFormulas: boolean;
  formulaBarHeight: number;
}

export interface DialogState {
  findReplace: boolean;
  formatCells: boolean;
  sort: boolean;
  dataValidation: boolean;
  conditionalFormat: boolean;
  nameManager: boolean;
  goalSeek: boolean;
  chartEditor: string | null; // chart id or null
}

export interface ComputedCache {
  values: Map<string, Scalar>;
  pending: boolean;
}

export interface SpreadsheetContextValue {
  workbook: Workbook;
  activeSheetId: SheetId;
  selection: SelectionState;
  editMode: EditMode;
  editValue: string;
  clipboard: ClipboardState;
  ui: UIState;
  dialogs: DialogState;
  computed: ComputedCache;
  // Actions
  dispatch: (action: AppAction) => void;
}

export type AppAction =
  | { type: 'SET_WORKBOOK'; workbook: Workbook }
  | { type: 'SET_ACTIVE_SHEET'; sheetId: SheetId }
  | { type: 'SELECT_CELL'; row: number; col: number; extend?: boolean; add?: boolean }
  | { type: 'SELECT_RANGE'; range: CellRect }
  | { type: 'START_SELECTING'; row: number; col: number }
  | { type: 'EXTEND_SELECTION'; row: number; col: number }
  | { type: 'END_SELECTING' }
  | { type: 'NAVIGATE'; direction: 'up' | 'down' | 'left' | 'right'; extend?: boolean; jump?: boolean }
  | { type: 'START_EDIT'; value?: string }
  | { type: 'SET_EDIT_VALUE'; value: string }
  | { type: 'COMMIT_EDIT' }
  | { type: 'CANCEL_EDIT' }
  | { type: 'APPLY_PATCHES'; patches: Patch[]; label: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'COPY' }
  | { type: 'CUT' }
  | { type: 'PASTE' }
  | { type: 'DELETE_CONTENT' }
  | { type: 'SET_RIBBON_TAB'; tab: RibbonTab }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'TOGGLE_GRIDLINES' }
  | { type: 'TOGGLE_FORMULAS' }
  | { type: 'TOGGLE_DIALOG'; dialog: keyof DialogState; value?: boolean | string | null }
  | { type: 'SET_COMPUTED'; values: Map<string, Scalar> }
  | { type: 'SET_CLIPBOARD'; clipboard: ClipboardState }
  | { type: 'ADD_SHEET' }
  | { type: 'DELETE_SHEET'; sheetId: SheetId }
  | { type: 'RENAME_SHEET'; sheetId: SheetId; name: string }
  | { type: 'REORDER_SHEETS'; order: SheetId[] }
  | { type: 'SELECT_ALL' }
  | { type: 'TAB_NAVIGATE'; reverse?: boolean }
  | { type: 'ENTER_NAVIGATE'; reverse?: boolean }
  | { type: 'HOME'; extend?: boolean; ctrl?: boolean }
  | { type: 'END'; extend?: boolean; ctrl?: boolean }
  | { type: 'PAGE_UP' }
  | { type: 'PAGE_DOWN' };
