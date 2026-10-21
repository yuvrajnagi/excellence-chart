import { createId, createWorkbook, entries, getCell, parseCellInput } from '@openexcel/model';
import type { Cell, CellAddress, CellRect, Patch, SheetId, Workbook } from '@openexcel/model';
import { adjustFormulaReferences } from '@openexcel/formula';
export const blankWorkbook = (name = 'Untitled workbook') => createWorkbook({id:createId('workbook'),sheetId:createId('sheet'),name,timestamp:new Date().toISOString()});
export const rect = (a:{row:number;col:number},b:{row:number;col:number}):CellRect => ({top:Math.min(a.row,b.row),bottom:Math.max(a.row,b.row),left:Math.min(a.col,b.col),right:Math.max(a.col,b.col)});
export const contains = (r:CellRect,row:number,col:number) => row>=r.top&&row<=r.bottom&&col>=r.left&&col<=r.right;
export function cellText(cell:Cell|undefined):string { if(!cell)return ''; return cell.input.kind==='formula'?cell.input.source:typeof cell.input.value==='object'?(cell.input.value?.code??''):String(cell.input.value??''); }
export function rangeAddresses(sheetId:SheetId,r:CellRect):CellAddress[] {if((r.bottom-r.top+1)*(r.right-r.left+1)>100000)throw new Error('Interactive edits are limited to 100,000 cells. Import larger datasets as a file.'); const out:CellAddress[]=[];for(let row=r.top;row<=r.bottom;row++)for(let col=r.left;col<=r.right;col++)out.push({sheetId,row,col});return out;}
export function inputPatch(w:Workbook,at:CellAddress,text:string):Patch {
 const rule=w.sheets[at.sheetId]?.properties.validations.find(r=>contains(r.range,at.row,at.col));
 const input=parseCellInput(text,w.properties.dateSystem);
 if(rule && !(text===''&&rule.allowBlank)){
  if(rule.kind==='list'&&rule.source.kind==='values'&&!rule.source.values.includes(text))throw new Error(rule.message);
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
 const position=(index:number)=>{let p=index*base;for(const v of overrides){if(v.index>=index)break;p+=v.size-base;}return p;};
 const size=(index:number)=>{const v=info[index];return v?.hidden?0:(v?.size??defaultSize)*zoom;};
 const indexAt=(offset:number)=>{let lo=0,hi=limit-1;while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(position(mid)<=offset)lo=mid;else hi=mid-1;}return lo;};
 return {position,size,indexAt,total:position(limit)};
}
export function usedRange(w:Workbook,sheetId:SheetId):CellRect {let bottom=0,right=0;for(const {at} of entries(w,{sheetId,top:0,left:0,bottom:1048575,right:16383})){bottom=Math.max(bottom,at.row);right=Math.max(right,at.col);}return{top:0,left:0,bottom,right};}
