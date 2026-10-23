import { createId, createWorkbook, entries, getCell, parseCellInput, TILE_ROWS, TILE_COLUMNS } from '@openexcel/model';
import type { AxisItem, Cell, CellAddress, CellKey, CellRect, Patch, Sheet, SheetId, Tile, TileKey, Workbook } from '@openexcel/model';
import { adjustFormulaReferences, tokenize } from '@openexcel/formula';
export const blankWorkbook = (name = 'Untitled workbook') => createWorkbook({id:createId('workbook'),sheetId:createId('sheet'),name,timestamp:new Date().toISOString()});
export const rect = (a:{row:number;col:number},b:{row:number;col:number}):CellRect => ({top:Math.min(a.row,b.row),bottom:Math.max(a.row,b.row),left:Math.min(a.col,b.col),right:Math.max(a.col,b.col)});
export const contains = (r:CellRect,row:number,col:number) => row>=r.top&&row<=r.bottom&&col>=r.left&&col<=r.right;
export function cellText(cell:Cell|undefined):string { if(!cell)return ''; return cell.input.kind==='formula'?cell.input.source:typeof cell.input.value==='object'?(cell.input.value?.code??''):String(cell.input.value??''); }
export function rangeAddresses(sheetId:SheetId,r:CellRect):CellAddress[] {if((r.bottom-r.top+1)*(r.right-r.left+1)>100000)throw new Error('Interactive edits are limited to 100,000 cells. Import larger datasets as a file.'); const out:CellAddress[]=[];for(let row=r.top;row<=r.bottom;row++)for(let col=r.left;col<=r.right;col++)out.push({sheetId,row,col});return out;}
export function inputPatch(w:Workbook,at:CellAddress,text:string):Patch {
 const rule=w.sheets[at.sheetId]?.properties.validations.find(r=>contains(r.range,at.row,at.col));
 const input=parseCellInput(text,w.properties.dateSystem);
 if(rule && !(text===''&&rule.allowBlank)){
  if(rule.kind==='list'){
   if(rule.source.kind==='values'&&!rule.source.values.includes(text))throw new Error(rule.message);
   if(rule.source.kind==='range'){
    const rng=rule.source.range,vals:string[]=[];
    for(let r=rng.top;r<=rng.bottom;r++)for(let c=rng.left;c<=rng.right;c++){
     const t=cellText(getCell(w,{sheetId:rng.sheetId,row:r,col:c}));
     if(t!=='')vals.push(t);
    }
    if(!vals.includes(text))throw new Error(rule.message);
   }
  }
  if(rule.kind==='number'&&(input.kind!=='value'||typeof input.value!=='number'||(rule.integer&&!Number.isInteger(input.value))||(rule.min!==undefined&&input.value<rule.min)||(rule.max!==undefined&&input.value>rule.max)))throw new Error(rule.message);
 }
 const old=getCell(w,at);return {kind:'cell',at,cell:{...old,input}};
}
export function fillPatches(w:Workbook,sheetId:SheetId,source:CellRect,target:CellRect):Patch[]{
 const out:Patch[]=[];const height=source.bottom-source.top+1,width=source.right-source.left+1;
 for(const at of rangeAddresses(sheetId,target)){
  if(contains(source,at.row,at.col))continue;
  const from={sheetId,row:source.top+((at.row-source.top)%height+height)%height,col:source.left+((at.col-source.left)%width+width)%width};
  let cell=getCell(w,from);if(cell?.input.kind==='formula')cell={...cell,input:{kind:'formula',source:adjustFormulaReferences(cell.input.source,at.row-from.row,at.col-from.col)}};
  else if(width===1&&height>=2){const a=getCell(w,{sheetId,row:source.top,col:source.left})?.input,b=getCell(w,{sheetId,row:source.top+1,col:source.left})?.input;if(a?.kind==='value'&&b?.kind==='value'&&typeof a.value==='number'&&typeof b.value==='number')cell={...cell,input:{kind:'value',value:a.value+(b.value-a.value)*(at.row-source.top)}};}
  out.push({kind:'cell',at,cell:cell??null});
 }return out;
}
// Sparse axis metadata keeps million-row coordinate lookup independent of sheet size.
export function axis(defaultSize:number,info:Readonly<Record<string,{size?:number;hidden?:boolean}>>,limit:number,zoom:number){
 const overrides=Object.entries(info).map(([i,v])=>({index:Number(i),size:v.hidden?0:(v.size??defaultSize)*zoom})).sort((a,b)=>a.index-b.index);const base=defaultSize*zoom;
 // Prefix deltas make coordinate lookup logarithmic even with many hidden rows.
 const prefix:number[]=[0];for(const item of overrides)prefix.push(prefix[prefix.length-1]!+item.size-base);
 const position=(index:number)=>{let lo=0,hi=overrides.length;while(lo<hi){const mid=(lo+hi)>>>1;if(overrides[mid]!.index<index)lo=mid+1;else hi=mid;}return index*base+prefix[lo]!;};
 const size=(index:number)=>{const v=info[index];return v?.hidden?0:(v?.size??defaultSize)*zoom;};
 const indexAt=(offset:number)=>{let lo=0,hi=limit-1;while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(position(mid)<=offset)lo=mid;else hi=mid-1;}return lo;};
 const visible=(start:number,count:number)=>{const out:number[]=[];let index=start;while(index<limit&&out.length<count){if(size(index)>0)out.push(index);const next=indexAt(position(index)+size(index));index=Math.max(index+1,next);}return out;};
 return {position,size,indexAt,visible,total:position(limit)};
}
export function usedRange(w:Workbook,sheetId:SheetId):CellRect {let bottom=0,right=0;for(const {at} of entries(w,{sheetId,top:0,left:0,bottom:1048575,right:16383})){bottom=Math.max(bottom,at.row);right=Math.max(right,at.col);}return{top:0,left:0,bottom,right};}

function shiftCellRect(r: CellRect, axis: 'row' | 'col', index: number, count: number): CellRect | null {
 if (count > 0) {
  if (axis === 'row') {
   const top = r.top >= index ? r.top + count : r.top;
   const bottom = r.bottom >= index ? r.bottom + count : r.bottom;
   if (top > 1048575) return null;
   return { ...r, top, bottom: Math.min(1048575, bottom) };
  } else {
   const left = r.left >= index ? r.left + count : r.left;
   const right = r.right >= index ? r.right + count : r.right;
   if (left > 16383) return null;
   return { ...r, left, right: Math.min(16383, right) };
  }
 } else {
  const delCount = -count;
  const endDel = index + delCount - 1;
  if (axis === 'row') {
   if (r.top >= index && r.bottom <= endDel) return null;
   const top = r.top < index ? r.top : (r.top <= endDel ? index : r.top - delCount);
   const bottom = r.bottom < index ? r.bottom : (r.bottom <= endDel ? index - 1 : r.bottom - delCount);
   if (top > bottom) return null;
   return { ...r, top, bottom };
  } else {
   if (r.left >= index && r.right <= endDel) return null;
   const left = r.left < index ? r.left : (r.left <= endDel ? index : r.left - delCount);
   const right = r.right < index ? r.right : (r.right <= endDel ? index - 1 : r.right - delCount);
   if (left > right) return null;
   return { ...r, left, right };
  }
 }
}

function shiftAxisInfo(info: Readonly<Record<string, AxisItem>>, index: number, count: number): Record<string, AxisItem> {
 const result: Record<string, AxisItem> = {};
 if (count > 0) {
  for (const [k, v] of Object.entries(info)) {
   const idx = Number(k);
   if (idx < index) result[idx] = v;
   else result[idx + count] = v;
  }
 } else {
  const delCount = -count;
  const endDel = index + delCount;
  for (const [k, v] of Object.entries(info)) {
   const idx = Number(k);
   if (idx < index) result[idx] = v;
   else if (idx >= endDel) result[idx - delCount] = v;
  }
 }
 return result;
}

const letters = (n: number) => {
 let s = '';
 for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
 return s;
};

export function rewriteFormulaReferences(
 source: string,
 axis: 'row' | 'col',
 op: 'insert' | 'delete',
 index: number,
 count: number,
 currentSheetNames?: string[]
): string {
 if (!source || !source.startsWith('=')) return source;
 try {
  const ts = tokenize(source);
  let out = '';
  let p = 0;
  for (let i = 0; i < ts.length; i++) {
   const t = ts[i]!;
   const m = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(t.text);
   if (m && ts[i + 1]?.text !== '!' && ts[i + 1]?.text !== '(' && t.kind !== 'string') {
    const hasSheetPrefix = ts[i - 1]?.text === '!';
    let prevSheet = '';
    let sheetStart = t.start;
    if (hasSheetPrefix) {
     prevSheet = ts[i - 2]?.text?.replace(/^'|'$/g, '').replace(/''/g, "'") ?? '';
     sheetStart = ts[i - 2]?.start ?? t.start;
     if (currentSheetNames && prevSheet && !currentSheetNames.includes(prevSheet)) {
      out += source.slice(p, t.end);
      p = t.end;
      continue;
     }
    }

    let col = 0;
    for (const c of m[2]!.toUpperCase()) col = col * 26 + c.charCodeAt(0) - 64;
    col = col - 1;
    let row = Number(m[4]) - 1;
    let isRef = false;

    if (axis === 'row') {
     if (op === 'insert') {
      if (row >= index) row += count;
     } else {
      if (row >= index && row < index + count) isRef = true;
      else if (row >= index + count) row -= count;
     }
    } else {
     if (op === 'insert') {
      if (col >= index) col += count;
     } else {
      if (col >= index && col < index + count) isRef = true;
      else if (col >= index + count) col -= count;
     }
    }

    if (isRef || row < 0 || col < 0 || row >= 1048576 || col >= 16384) {
     out += source.slice(p, sheetStart);
     out += '#REF!';
    } else {
     out += source.slice(p, t.start);
     out += m[1] + letters(col) + m[3] + String(row + 1);
    }
    p = t.end;
   }
  }
  return out + source.slice(p);
 } catch {
  return source;
 }
}

export function insertRow(workbook: Workbook, sheetId: string, rowIndex: number, count = 1): Workbook {
 if (count <= 0) return workbook;
 const sheet = workbook.sheets[sheetId];
 if (!sheet) return workbook;

 const sheetNames = [sheet.properties.name, sheetId];
 const newTiles: Partial<Record<TileKey, Tile>> = {};
 const setCell = (r: number, c: number, cell: Cell) => {
  if (r < 0 || r >= 1048576 || c < 0 || c >= 16384) return;
  const tk = `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}` as TileKey;
  const ck = `${r}:${c}` as CellKey;
  let tile = newTiles[tk];
  if (!tile) {
   tile = {};
   newTiles[tk] = tile;
  }
  (tile as Record<string, Cell>)[ck] = cell;
 };

 for (const tile of Object.values(sheet.tiles)) {
  if (!tile) continue;
  for (const [ck, cell] of Object.entries(tile)) {
   if (!cell) continue;
   const [r = 0, c = 0] = ck.split(':').map(Number);
   const targetRow = r >= rowIndex ? r + count : r;
   let newCell = cell;
   if (newCell.input.kind === 'formula') {
    newCell = {
     ...newCell,
     input: {
      ...newCell.input,
      source: rewriteFormulaReferences(newCell.input.source, 'row', 'insert', rowIndex, count, sheetNames),
     },
    };
   }
   setCell(targetRow, c, newCell);
  }
 }

 const rowInfo = shiftAxisInfo(sheet.properties.rowInfo, rowIndex, count);
 const merges = sheet.properties.merges
  .map(m => shiftCellRect(m, 'row', rowIndex, count))
  .filter((m): m is CellRect => m !== null);
 const groups = sheet.properties.groups.map(g => {
  if (g.axis !== 'row') return g;
  const start = g.start >= rowIndex ? g.start + count : g.start;
  const end = g.end >= rowIndex ? g.end + count : g.end;
  return { ...g, start, end };
 });
 const conditionalFormats = sheet.properties.conditionalFormats
  .map(cf => {
   const r = shiftCellRect(cf.range, 'row', rowIndex, count);
   return r ? { ...cf, range: r } : null;
  })
  .filter((cf): cf is NonNullable<typeof cf> => cf !== null);
 const validations = sheet.properties.validations
  .map(v => {
   const r = shiftCellRect(v.range, 'row', rowIndex, count);
   return r ? { ...v, range: r } : null;
  })
  .filter((v): v is NonNullable<typeof v> => v !== null);

 const updatedSheet: Sheet = {
  ...sheet,
  tiles: newTiles,
  properties: {
   ...sheet.properties,
   rowInfo,
   merges,
   groups,
   conditionalFormats,
   validations,
  },
 };

 return {
  ...workbook,
  revision: workbook.revision + 1,
  properties: {
   ...workbook.properties,
   modifiedAt: new Date().toISOString(),
  },
  sheets: {
   ...workbook.sheets,
   [sheetId]: updatedSheet,
  },
 };
}

export function deleteRow(workbook: Workbook, sheetId: string, rowIndex: number, count = 1): Workbook {
 if (count <= 0) return workbook;
 const sheet = workbook.sheets[sheetId];
 if (!sheet) return workbook;

 const endDel = rowIndex + count;
 const sheetNames = [sheet.properties.name, sheetId];
 const newTiles: Partial<Record<TileKey, Tile>> = {};
 const setCell = (r: number, c: number, cell: Cell) => {
  if (r < 0 || r >= 1048576 || c < 0 || c >= 16384) return;
  const tk = `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}` as TileKey;
  const ck = `${r}:${c}` as CellKey;
  let tile = newTiles[tk];
  if (!tile) {
   tile = {};
   newTiles[tk] = tile;
  }
  (tile as Record<string, Cell>)[ck] = cell;
 };

 for (const tile of Object.values(sheet.tiles)) {
  if (!tile) continue;
  for (const [ck, cell] of Object.entries(tile)) {
   if (!cell) continue;
   const [r = 0, c = 0] = ck.split(':').map(Number);
   if (r >= rowIndex && r < endDel) {
    continue;
   }
   const targetRow = r >= endDel ? r - count : r;
   let newCell = cell;
   if (newCell.input.kind === 'formula') {
    newCell = {
     ...newCell,
     input: {
      ...newCell.input,
      source: rewriteFormulaReferences(newCell.input.source, 'row', 'delete', rowIndex, count, sheetNames),
     },
    };
   }
   setCell(targetRow, c, newCell);
  }
 }

 const rowInfo = shiftAxisInfo(sheet.properties.rowInfo, rowIndex, -count);
 const merges = sheet.properties.merges
  .map(m => shiftCellRect(m, 'row', rowIndex, -count))
  .filter((m): m is CellRect => m !== null);
 const groups = sheet.properties.groups
  .map(g => {
   if (g.axis !== 'row') return g;
   if (g.start >= endDel) return { ...g, start: g.start - count, end: g.end - count };
   if (g.end < rowIndex) return g;
   const start = Math.min(rowIndex, g.start);
   const end = Math.max(rowIndex, g.end - count);
   return { ...g, start, end };
  })
  .filter(g => g.axis !== 'row' || g.end >= g.start);
 const conditionalFormats = sheet.properties.conditionalFormats
  .map(cf => {
   const r = shiftCellRect(cf.range, 'row', rowIndex, -count);
   return r ? { ...cf, range: r } : null;
  })
  .filter((cf): cf is NonNullable<typeof cf> => cf !== null);
 const validations = sheet.properties.validations
  .map(v => {
   const r = shiftCellRect(v.range, 'row', rowIndex, -count);
   return r ? { ...v, range: r } : null;
  })
  .filter((v): v is NonNullable<typeof v> => v !== null);

 const updatedSheet: Sheet = {
  ...sheet,
  tiles: newTiles,
  properties: {
   ...sheet.properties,
   rowInfo,
   merges,
   groups,
   conditionalFormats,
   validations,
  },
 };

 return {
  ...workbook,
  revision: workbook.revision + 1,
  properties: {
   ...workbook.properties,
   modifiedAt: new Date().toISOString(),
  },
  sheets: {
   ...workbook.sheets,
   [sheetId]: updatedSheet,
  },
 };
}

export function insertColumn(workbook: Workbook, sheetId: string, colIndex: number, count = 1): Workbook {
 if (count <= 0) return workbook;
 const sheet = workbook.sheets[sheetId];
 if (!sheet) return workbook;

 const sheetNames = [sheet.properties.name, sheetId];
 const newTiles: Partial<Record<TileKey, Tile>> = {};
 const setCell = (r: number, c: number, cell: Cell) => {
  if (r < 0 || r >= 1048576 || c < 0 || c >= 16384) return;
  const tk = `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}` as TileKey;
  const ck = `${r}:${c}` as CellKey;
  let tile = newTiles[tk];
  if (!tile) {
   tile = {};
   newTiles[tk] = tile;
  }
  (tile as Record<string, Cell>)[ck] = cell;
 };

 for (const tile of Object.values(sheet.tiles)) {
  if (!tile) continue;
  for (const [ck, cell] of Object.entries(tile)) {
   if (!cell) continue;
   const [r = 0, c = 0] = ck.split(':').map(Number);
   const targetCol = c >= colIndex ? c + count : c;
   let newCell = cell;
   if (newCell.input.kind === 'formula') {
    newCell = {
     ...newCell,
     input: {
      ...newCell.input,
      source: rewriteFormulaReferences(newCell.input.source, 'col', 'insert', colIndex, count, sheetNames),
     },
    };
   }
   setCell(r, targetCol, newCell);
  }
 }

 const columnInfo = shiftAxisInfo(sheet.properties.columnInfo, colIndex, count);
 const merges = sheet.properties.merges
  .map(m => shiftCellRect(m, 'col', colIndex, count))
  .filter((m): m is CellRect => m !== null);
 const groups = sheet.properties.groups.map(g => {
  if (g.axis !== 'column') return g;
  const start = g.start >= colIndex ? g.start + count : g.start;
  const end = g.end >= colIndex ? g.end + count : g.end;
  return { ...g, start, end };
 });
 const conditionalFormats = sheet.properties.conditionalFormats
  .map(cf => {
   const r = shiftCellRect(cf.range, 'col', colIndex, count);
   return r ? { ...cf, range: r } : null;
  })
  .filter((cf): cf is NonNullable<typeof cf> => cf !== null);
 const validations = sheet.properties.validations
  .map(v => {
   const r = shiftCellRect(v.range, 'col', colIndex, count);
   return r ? { ...v, range: r } : null;
  })
  .filter((v): v is NonNullable<typeof v> => v !== null);

 const updatedSheet: Sheet = {
  ...sheet,
  tiles: newTiles,
  properties: {
   ...sheet.properties,
   columnInfo,
   merges,
   groups,
   conditionalFormats,
   validations,
  },
 };

 return {
  ...workbook,
  revision: workbook.revision + 1,
  properties: {
   ...workbook.properties,
   modifiedAt: new Date().toISOString(),
  },
  sheets: {
   ...workbook.sheets,
   [sheetId]: updatedSheet,
  },
 };
}

export function deleteColumn(workbook: Workbook, sheetId: string, colIndex: number, count = 1): Workbook {
 if (count <= 0) return workbook;
 const sheet = workbook.sheets[sheetId];
 if (!sheet) return workbook;

 const endDel = colIndex + count;
 const sheetNames = [sheet.properties.name, sheetId];
 const newTiles: Partial<Record<TileKey, Tile>> = {};
 const setCell = (r: number, c: number, cell: Cell) => {
  if (r < 0 || r >= 1048576 || c < 0 || c >= 16384) return;
  const tk = `${Math.floor(r / TILE_ROWS)}:${Math.floor(c / TILE_COLUMNS)}` as TileKey;
  const ck = `${r}:${c}` as CellKey;
  let tile = newTiles[tk];
  if (!tile) {
   tile = {};
   newTiles[tk] = tile;
  }
  (tile as Record<string, Cell>)[ck] = cell;
 };

 for (const tile of Object.values(sheet.tiles)) {
  if (!tile) continue;
  for (const [ck, cell] of Object.entries(tile)) {
   if (!cell) continue;
   const [r = 0, c = 0] = ck.split(':').map(Number);
   if (c >= colIndex && c < endDel) {
    continue;
   }
   const targetCol = c >= endDel ? c - count : c;
   let newCell = cell;
   if (newCell.input.kind === 'formula') {
    newCell = {
     ...newCell,
     input: {
      ...newCell.input,
      source: rewriteFormulaReferences(newCell.input.source, 'col', 'delete', colIndex, count, sheetNames),
     },
    };
   }
   setCell(r, targetCol, newCell);
  }
 }

 const columnInfo = shiftAxisInfo(sheet.properties.columnInfo, colIndex, -count);
 const merges = sheet.properties.merges
  .map(m => shiftCellRect(m, 'col', colIndex, -count))
  .filter((m): m is CellRect => m !== null);
 const groups = sheet.properties.groups
  .map(g => {
   if (g.axis !== 'column') return g;
   if (g.start >= endDel) return { ...g, start: g.start - count, end: g.end - count };
   if (g.end < colIndex) return g;
   const start = Math.min(colIndex, g.start);
   const end = Math.max(colIndex, g.end - count);
   return { ...g, start, end };
  })
  .filter(g => g.axis !== 'column' || g.end >= g.start);
 const conditionalFormats = sheet.properties.conditionalFormats
  .map(cf => {
   const r = shiftCellRect(cf.range, 'col', colIndex, -count);
   return r ? { ...cf, range: r } : null;
  })
  .filter((cf): cf is NonNullable<typeof cf> => cf !== null);
 const validations = sheet.properties.validations
  .map(v => {
   const r = shiftCellRect(v.range, 'col', colIndex, -count);
   return r ? { ...v, range: r } : null;
  })
  .filter((v): v is NonNullable<typeof v> => v !== null);

 const updatedSheet: Sheet = {
  ...sheet,
  tiles: newTiles,
  properties: {
   ...sheet.properties,
   columnInfo,
   merges,
   groups,
   conditionalFormats,
   validations,
  },
 };

 return {
  ...workbook,
  revision: workbook.revision + 1,
  properties: {
   ...workbook.properties,
   modifiedAt: new Date().toISOString(),
  },
  sheets: {
   ...workbook.sheets,
   [sheetId]: updatedSheet,
  },
 };
}

