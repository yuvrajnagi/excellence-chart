import { getCell, matchesFilter } from '@openexcel/model';
import type { Aggregate, Cell, Patch, RangeRef, Scalar, SortKey, ValueReader, Workbook, FilterPredicate } from '@openexcel/model';

const MAX_OPERATION_CELLS = 1_000_000;
function checkRange(range: RangeRef): void {
  const size = (range.bottom-range.top+1)*(range.right-range.left+1);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_OPERATION_CELLS) throw new RangeError('Operation requires between 1 and 1,000,000 cells');
}
export function readRows(range: RangeRef, reader: ValueReader): Scalar[][] {
  checkRange(range);
  return Array.from({length:range.bottom-range.top+1},(_,i)=>Array.from({length:range.right-range.left+1},(_,j)=>reader.value({sheetId:range.sheetId,row:range.top+i,col:range.left+j})));
}
function compare(a: Scalar, b: Scalar): number {
  const rank = (v: Scalar): number => v === null ? 4 : typeof v === "number" ? 0
    : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3;
  const ar = rank(a), br = rank(b);
  if (ar !== br) return ar - br;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") return a.code.localeCompare(b.code, 'en');
  return 0;
}
/** Sorting moves whole authored cells including formatting; calculated values are comparison keys. */
export function sortRange(workbook: Workbook, range: RangeRef, keys: readonly SortKey[], reader: ValueReader): Patch[] {
  checkRange(range);
  const rows = Array.from({length:range.bottom-range.top+1},(_,i)=>range.top+i);
  rows.sort((a,b)=>{
    for(const key of keys){
      const c=compare(reader.value({sheetId:range.sheetId,row:a,col:range.left+key.offset}),reader.value({sheetId:range.sheetId,row:b,col:range.left+key.offset}));
      if(c)return key.direction==='asc'?c:-c;
    }return a-b;
  });
  const patches:Patch[]=[];
  rows.forEach((source,i)=>{for(let col=range.left;col<=range.right;col++) patches.push({kind:'cell',at:{sheetId:range.sheetId,row:range.top+i,col},cell:getCell(workbook,{sheetId:range.sheetId,row:source,col})??null});});
  return patches;
}
export function removeDuplicates(workbook: Workbook, range: RangeRef, columns: readonly number[], reader: ValueReader): Patch[] {
  checkRange(range);const seen=new Set<string>();const rows:number[]=[];
  for(let row=range.top;row<=range.bottom;row++){
    const key=JSON.stringify(columns.map(offset=>reader.value({sheetId:range.sheetId,row,col:range.left+offset})));
    if(!seen.has(key)){seen.add(key);rows.push(row);}
  }
  const patches:Patch[]=[];
  for(let row=range.top;row<=range.bottom;row++)for(let col=range.left;col<=range.right;col++){
    const source=rows[row-range.top];
    patches.push({kind:'cell',at:{sheetId:range.sheetId,row,col},cell:source===undefined?null:getCell(workbook,{sheetId:range.sheetId,row:source,col})??null});
  }return patches;
}
export function textToColumns(workbook: Workbook, range: RangeRef, delimiter: string, reader: ValueReader): Patch[] {
  checkRange(range);if(!delimiter)throw new Error('Delimiter must not be empty');const patches:Patch[]=[];
  for(let row=range.top;row<=range.bottom;row++){
    const value=reader.value({sheetId:range.sheetId,row,col:range.left});
    const parts=String(value??'').split(delimiter);
    if(range.left+parts.length>16384)throw new RangeError('Split exceeds worksheet columns');
    parts.forEach((text,offset)=>{
      const at={sheetId:range.sheetId,row,col:range.left+offset};
      if(offset && getCell(workbook,at)?.input.kind==='formula')throw new Error('Split would overwrite a formula');
      patches.push({kind:'cell',at,cell:{input:{kind:'value',value:text}}});
    });
  }return patches;
}
export function aggregate(values: readonly Scalar[], method: Aggregate): Scalar {
  const numbers=values.filter((v):v is number=>typeof v==='number');
  if(method==='count')return values.filter(v=>v!==null&&v!=='').length;
  if(method==='countNumbers')return numbers.length;
  if(!numbers.length)return method==='average'?{kind:'error',code:'#DIV/0!'}:0;
  if(method==='min')return numbers.reduce((a,b)=>Math.min(a,b),Infinity);
  if(method==='max')return numbers.reduce((a,b)=>Math.max(a,b),-Infinity);
  const sum=numbers.reduce((a,b)=>a+b,0);return method==='average'?sum/numbers.length:sum;
}
/** Materialize a pivot matrix from data rows (without headers), with multi-dimension row/column keys. */
export function pivotRows(rows: readonly (readonly Scalar[])[], rowOffsets: readonly number[], columnOffsets: readonly number[], valueOffset:number, method:Aggregate='sum', filters:readonly {offset:number;predicate:FilterPredicate}[]=[]): Scalar[][] {
  const rowKeys=new Map<string,Scalar[]>();const colKeys=new Map<string,Scalar[]>();const groups=new Map<string,Scalar[]>();
  for(const row of rows){
    if(filters.some(f=>!matchesFilter(row[f.offset]??null,f.predicate)))continue;
    const r=rowOffsets.map(i=>row[i]??null),c=columnOffsets.map(i=>row[i]??null);const rk=JSON.stringify(r),ck=JSON.stringify(c);
    rowKeys.set(rk,r);colKeys.set(ck,c);const key=JSON.stringify([rk,ck]);const bucket=groups.get(key)??[];bucket.push(row[valueOffset]??null);groups.set(key,bucket);
  }
  if(!colKeys.size)colKeys.set('[]',[]);
  const cols=[...colKeys.keys()];const output:Scalar[][]=[[...rowOffsets.map((_,i)=>`Row ${i+1}`),...cols.map(k=>(colKeys.get(k)??[]).join(' / ')||method)]];
  for(const [rk,label]of rowKeys)output.push([...label,...cols.map(ck=>aggregate(groups.get(JSON.stringify([rk,ck]))??[],method))]);
  return output;
}
export interface GoalSeekResult { converged:boolean; value:number; result:number; iterations:number }
/** Secant iteration with finite checks and bounded steps; callers choose a pure scenario evaluator. */
export function goalSeek(fn:(input:number)=>number,target:number,initial=0,tolerance=1e-7,maxIterations=100):GoalSeekResult {
  let x0=initial,x1=initial+Math.max(1,Math.abs(initial)*0.01);let y0=fn(x0)-target;
  for(let i=0;i<maxIterations;i++){
    const y1=fn(x1)-target;
    if(!Number.isFinite(y1))return {converged:false,value:x1,result:y1+target,iterations:i+1};
    if(Math.abs(y1)<=tolerance)return {converged:true,value:x1,result:y1+target,iterations:i+1};
    if(y1===y0)return {converged:false,value:x1,result:y1+target,iterations:i+1};
    const next=x1-y1*(x1-x0)/(y1-y0);x0=x1;y0=y1;x1=next;
  }
  return {converged:false,value:x1,result:fn(x1),iterations:maxIterations};
}
export function inferSeries(cells:readonly Cell[],count:number):Cell[] {
  if(!Number.isInteger(count)||count<0||count>MAX_OPERATION_CELLS)throw new RangeError('Invalid fill count');
  const values=cells.map(c=>c.input.kind==='value'?c.input.value:null);
  const first=values[0],last=values[values.length-1];
  if(values.length>1&&values.every(v=>typeof v==='number')&&typeof first==='number'&&typeof last==='number'){
    const step=(last-first)/(values.length-1);
    return Array.from({length:count},(_,i)=>({input:{kind:'value',value:last+step*(i+1)}}));
  }
  return Array.from({length:count},(_,i)=>cells[i%cells.length]??{input:{kind:'value',value:null}});
}

/** Refresh only a pivot's recorded output; reject overlapping authored data before generating edits. */
export function refreshPivot(workbook:Workbook, definition:import('@openexcel/model').PivotDefinition, reader:ValueReader):Patch[] {
  const sheet=workbook.sheets[definition.destination.sheetId];
  if(!sheet)throw Error('Pivot destination sheet does not exist');
  if(definition.values.length!==1)throw Error('This pivot renderer supports one value field per pivot');
  const field=definition.values[0]!;
  const source=readRows(definition.source,reader);const headers=source.shift()??[];
  const rows=source.filter(row=>definition.filters.every(f=>matchesFilter(row[f.offset]??null,f.predicate)));
  const matrix=pivotRows(rows,definition.rows,definition.columns,field.offset,field.aggregate);
  const dimensionCount=definition.rows.length;
  matrix[0]!.splice(0,dimensionCount,...definition.rows.map(offset=>headers[offset]??`Row ${offset+1}`));
  if(definition.rowTotals){
    matrix[0]!.push('Grand Total');
    for(let i=1;i<matrix.length;i++){
      const label=matrix[i]!.slice(0,dimensionCount);
      const bucket=rows.filter(row=>definition.rows.every((offset,j)=>row[offset]===label[j]));
      matrix[i]!.push(aggregate(bucket.map(row=>row[field.offset]??null),field.aggregate));
    }
  }
  if(definition.columnTotals){
    const columnLabels=[...new Map(rows.map(row=>{const key=definition.columns.map(i=>row[i]??null);return [JSON.stringify(key),key] as const;})).values()];
    const total:Scalar[]=[...definition.rows.map((_,i)=>i===0?'Grand Total':'')];
    for(const label of columnLabels){const bucket=rows.filter(row=>definition.columns.every((offset,j)=>(row[offset]??null)===label[j]));total.push(aggregate(bucket.map(row=>row[field.offset]??null),field.aggregate));}
    if(definition.rowTotals)total.push(aggregate(rows.map(row=>row[field.offset]??null),field.aggregate));
    matrix.push(total);
  }
  const output:RangeRef={sheetId:sheet.id,top:definition.destination.row,left:definition.destination.col,bottom:definition.destination.row+matrix.length-1,right:definition.destination.col+(matrix[0]?.length??1)-1};
  checkRange(output);
  if(output.bottom>=1048576||output.right>=16384)throw Error('Pivot exceeds worksheet bounds');
  const intersects=(a:RangeRef,b:RangeRef)=>a.sheetId===b.sheetId&&a.top<=b.bottom&&a.bottom>=b.top&&a.left<=b.right&&a.right>=b.left;
  const inside=(range:RangeRef|undefined,row:number,col:number)=>range?.sheetId===sheet.id&&row>=range.top&&row<=range.bottom&&col>=range.left&&col<=range.right;
  if(intersects(output,definition.source))throw Error('Pivot output overlaps its source');
  if(sheet.properties.merges.some(m=>intersects(output,{...m,sheetId:sheet.id})))throw Error('Pivot output overlaps merged cells');
  if(sheet.properties.pivots.some(p=>p.id!==definition.id&&p.output&&intersects(output,p.output)))throw Error('Pivot output overlaps another pivot');
  for(let row=output.top;row<=output.bottom;row++)for(let col=output.left;col<=output.right;col++){
    const cell=getCell(workbook,{sheetId:sheet.id,row,col});
    if(cell&&!inside(definition.output,row,col)&&(cell.input.kind==='formula'||cell.input.value!==null))throw Error('Pivot output would overwrite existing cells');
  }
  const patches:Patch[]=[];
  if(definition.output){checkRange(definition.output);for(let row=definition.output.top;row<=definition.output.bottom;row++)for(let col=definition.output.left;col<=definition.output.right;col++)patches.push({kind:'cell',at:{sheetId:definition.output.sheetId,row,col},cell:null});}
  matrix.forEach((row,i)=>row.forEach((value,j)=>patches.push({kind:'cell',at:{sheetId:sheet.id,row:output.top+i,col:output.left+j},cell:{input:{kind:'value',value}}})));
  const refreshed={...definition,output,refreshedAtRevision:workbook.revision+1};
  patches.push({kind:'sheetProperties',sheetId:sheet.id,properties:{...sheet.properties,pivots:[...sheet.properties.pivots.filter(p=>p.id!==definition.id),refreshed]}});
  return patches;
}
