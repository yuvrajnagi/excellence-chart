import { addNativeCharts } from './charts.js';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { createWorkbook, createId, getCell, formatAddress, parseWorkbook, parseCellInput, entries, DEFAULT_LIMITS } from '@openexcel/model';
import type { Workbook, WorkbookId, SheetId, CellKey, Cell, CellStyle, TileKey, ResourceLimits, Result, CompatibilityIssue, FileOptions, Scalar } from '@openexcel/model';
export interface InteropLimits { maxInputBytes:number; maxExpandedBytes:number; maxZipEntries:number; maxExpansionRatio:number; maxFieldBytes:number; workbook:ResourceLimits }
export const DEFAULT_INTEROP_LIMITS:InteropLimits={maxInputBytes:32*1024*1024,maxExpandedBytes:128*1024*1024,maxZipEntries:10000,maxExpansionRatio:1000,maxFieldBytes:131068,workbook:DEFAULT_LIMITS};
export interface ImportOptions { format:'xlsx'|'csv'|'tsv'; workbookId:WorkbookId; firstSheetId:SheetId; name:string; timestamp:string; delimiter?:','|';'|'\\t'; parseCsvFormulas:boolean; limits:InteropLimits; signal?:AbortSignal }
export interface ImportResult {workbook:Workbook;issues:readonly CompatibilityIssue[]}
export interface ExportCache {revision:number;values:Readonly<Record<string,Readonly<Partial<Record<CellKey,Scalar>>>>>}
export interface ExportOptions {file:FileOptions;cache:ExportCache;limits:InteropLimits;signal?:AbortSignal}
export interface ExportResult {bytes:Uint8Array;mediaType:string;filename:string;issues:readonly CompatibilityIssue[]}
const issue=(feature:string,message:string):CompatibilityIssue=>({code:'LOSSY_CONVERSION',severity:'warning',feature,message});
const checkCancel=(signal?:AbortSignal)=>{if(signal?.aborted)throw Error('Operation cancelled');};
/** Match private metadata only to the exact standard package it describes.
 * Excel and other editors can retain unknown parts while changing native cells.
 * Hashing uncompressed bytes avoids dependence on ZIP timestamps/compression.
 */
function nativeManifest(files:Record<string,Uint8Array>):Record<string,string>{
 return Object.fromEntries(Object.keys(files).filter(name=>!name.startsWith('openexcel/')).sort().map(name=>[name,createHash('sha256').update(files[name]!).digest('hex')]));
}
function metadataMatches(files:Record<string,Uint8Array>):boolean{
 try{const stored=files['openexcel/manifest.json'];if(!stored)return false;const value=JSON.parse(strFromU8(stored)) as {version?:unknown;parts?:unknown};if(value.version!==1||!value.parts||typeof value.parts!=='object'||Array.isArray(value.parts))return false;
 const expected=nativeManifest(files),actual=value.parts as Record<string,unknown>;return Object.keys(actual).length===Object.keys(expected).length&&Object.entries(expected).every(([name,digest])=>actual[name]===digest);
 }catch{return false;}
}
function archive(bytes:Uint8Array,limits:InteropLimits){
  // Validate exactly the entries selected by the ZIP reader before it allocates
  // output buffers. A signature scan can miss ZIP64 metadata or trust decoys.
  let total=0,count=0;const names=new Set<string>();
  const files=unzipSync(bytes,{filter(entry){
    const {name,size,originalSize,compression}=entry;
    if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||names.has(name))throw Error('Unsafe ZIP entry');
    names.add(name);total+=originalSize;count++;
    if(!Number.isSafeInteger(originalSize)||originalSize<0||total>limits.maxExpandedBytes||count>limits.maxZipEntries||originalSize/Math.max(1,size)>limits.maxExpansionRatio)throw Error('ZIP resource limit');
    if(compression!==0&&compression!==8)throw Error('Unsupported ZIP compression');
    return true;
  }});
  if(!count)throw Error('Invalid XLSX archive'); let actual=0;
  for(const [name,data] of Object.entries(files)){actual+=data.length;if(actual>limits.maxExpandedBytes)throw Error('Expanded resource limit');if(/\.(xml|rels)$/i.test(name)){
    const xml=strFromU8(data);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('XML declarations forbidden');
    if(/TargetMode\s*=\s*["']External["']/i.test(xml))throw Error('External relationships are not supported');
  }}
  return files;
}
export function parseDelimited(text:string,delimiter:string):string[][]{
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){const c=text[i]!;
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
    else if(c===delimiter){row.push(field);field='';closed=false;}
    else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';closed=false;}
    else if(c==='"'&&!field&&!closed)quoted=true;
    else {if(closed)throw Error('Unexpected text after closing quote');field+=c;}
  }
  if(quoted)throw Error('Unclosed CSV quote');if(field||row.length||closed){row.push(field);rows.push(row);}return rows;
}
function put(tiles:Record<TileKey,Record<CellKey,Cell>>,r:number,c:number,cell:Cell){const tk:TileKey=`${Math.floor(r/128)}:${Math.floor(c/32)}`;(tiles[tk]??={})[`${r}:${c}`]=cell;}
function importedStyle(c:ExcelJS.Cell):CellStyle {
  const s:CellStyle={...(c.numFmt?{numberFormat:c.numFmt}:{}),...(c.font?{font:{...(c.font.name?{family:c.font.name}:{}),...(c.font.size?{size:c.font.size}:{}),...(c.font.bold?{bold:true}:{}),...(c.font.italic?{italic:true}:{}),...(c.font.underline?{underline:true}:{}),...(c.font.strike?{strikethrough:true}:{}),...(c.font.color?.argb?{color:'#'+c.font.color.argb.slice(-6)}:{})}}:{}),...(c.fill?.type==='pattern'&&c.fill.fgColor?.argb?{fill:'#'+c.fill.fgColor.argb.slice(-6)}:{}),...(c.alignment?.wrapText?{wrap:true}:{}),...(['left','center','right'].includes(c.alignment?.horizontal??'')?{horizontal:c.alignment.horizontal as 'left'|'center'|'right'}:{}),...(['top','middle','bottom'].includes(c.alignment?.vertical??'')?{vertical:c.alignment.vertical as 'top'|'middle'|'bottom'}:{}),...(typeof c.alignment?.textRotation==='number'?{rotation:c.alignment.textRotation}:{})};
  const borders:NonNullable<CellStyle['borders']>={};
  for(const side of ['top','right','bottom','left'] as const){const border=c.border?.[side];if(border?.style&&['thin','medium','thick','dashed','dotted','double'].includes(border.style))Object.assign(borders,{[side]:{style:border.style,color:'#'+(border.color?.argb?.slice(-6)??'000000')}});}
  return Object.keys(borders).length?{...s,borders}:s;
}
export async function importWorkbook(bytes:Uint8Array,o:ImportOptions):Promise<Result<ImportResult>>{
  try{
    checkCancel(o.signal);if(bytes.length>o.limits.maxInputBytes)throw Error('Input resource limit');
    let w=createWorkbook({id:o.workbookId,sheetId:o.firstSheetId,name:o.name,timestamp:o.timestamp});const issues:CompatibilityIssue[]=[];
    if(o.format!=='xlsx'){
      const rows=parseDelimited(new TextDecoder('utf-8',{fatal:true}).decode(bytes),o.format==='tsv'?'\t':o.delimiter==='\\t'?'\t':o.delimiter??',');const tiles:Record<TileKey,Record<CellKey,Cell>>={};let count=0;
      rows.forEach((row,r)=>row.forEach((text,c)=>{if(++count>o.limits.workbook.maxAuthoredCells||Buffer.byteLength(text)>o.limits.maxFieldBytes)throw Error('CSV resource limit');if(text)put(tiles,r,c,{input:!o.parseCsvFormulas&&text.startsWith('=')?{kind:'value',value:text}:parseCellInput(text,'1900')});}));
      w={...w,sheets:{[o.firstSheetId]:{...w.sheets[o.firstSheetId]!,tiles}}};
    }else{
      const files=archive(bytes,o.limits);const x=new ExcelJS.Workbook();await x.xlsx.load(Buffer.from(zipSync(files)) as never);
      let extension:Workbook|undefined;if(files['openexcel/workbook.json']){
        if(!metadataMatches(files))issues.push(issue('extension','Stale or unverifiable OpenExcel metadata was ignored because native workbook parts changed or its manifest is missing.'));
        else {try{const parsed=parseWorkbook(JSON.parse(strFromU8(files['openexcel/workbook.json']!)),o.limits.workbook);if(parsed.ok)extension=parsed.value;else issues.push(issue('extension','Invalid OpenExcel extension was ignored'));}catch{issues.push(issue('extension','Invalid OpenExcel extension was ignored'));}}
      }
      const sheets:Record<string,Workbook['sheets'][string]>={},order:SheetId[]=[],styles:Record<string,CellStyle>={...extension?.styles};let count=0;
      for(const ws of x.worksheets){if(order.length>=o.limits.workbook.maxSheets)throw Error('Sheet resource limit');checkCancel(o.signal);
        const previous=extension&&Object.values(extension.sheets).find(s=>s.properties.name===ws.name);
        const id=previous?.id??(order.length?createId('sheet'):o.firstSheetId);order.push(id);const base=createWorkbook({id:o.workbookId,sheetId:id,name:o.name,timestamp:o.timestamp}).sheets[id]!;const tiles:Record<TileKey,Record<CellKey,Cell>>={};
        ws.eachRow(row=>row.eachCell(c=>{if(c.type===ExcelJS.ValueType.Merge)return;if(++count>o.limits.workbook.maxAuthoredCells)throw Error('Cell resource limit');let input:Cell['input'];
          if(c.formula)input={kind:'formula',source:'='+c.formula};else if(c.value instanceof Date)input={kind:'value',value:(c.value.getTime()-Date.UTC(1899,11,30))/86400000-(x.properties.date1904?1462:0)};else if(c.value&&typeof c.value==='object'&&'error'in c.value)input={kind:'value',value:{kind:'error',code:c.value.error}};else input={kind:'value',value:typeof c.value==='object'?c.text:c.value??null};
          const style=importedStyle(c),original=extension&&previous?getCell(extension,{sheetId:previous.id,row:Number(c.row)-1,col:Number(c.col)-1}):undefined,styleId=original?.styleId??(Object.keys(style).length?createId('style'):undefined);if(styleId&&!original?.styleId)styles[styleId]=style;
          put(tiles,Number(c.row)-1,Number(c.col)-1,{input,...(styleId?{styleId}:{})});
        }));
        const rowInfo:Record<string,{size?:number;hidden?:boolean}>={},columnInfo:Record<string,{size?:number;hidden?:boolean}>={};ws.eachRow(row=>{if(row.height||row.hidden)rowInfo[String(row.number-1)]={...(row.height?{size:row.height*4/3}:{}),...(row.hidden?{hidden:true}:{})};});ws.columns?.forEach((col,i)=>{if(col.width||col.hidden)columnInfo[String(i)]={...(col.width?{size:col.width*7}:{}),...(col.hidden?{hidden:true}:{})};});
        const merges=(ws.model.merges??[]).map(ref=>{const [a,b=a]=ref.split(':');const decode=(s:string)=>{const m=/^([A-Z]+)(\d+)$/.exec(s)!;let col=0;for(const ch of m[1]!)col=col*26+ch.charCodeAt(0)-64;return{row:Number(m[2])-1,col:col-1};};const p=decode(a!),q=decode(b!);return{top:p.row,left:p.col,bottom:q.row,right:q.col};});
        sheets[id]={id,tiles,properties:{...(previous?.properties??base.properties),name:ws.name,hidden:ws.state!=='visible',rowInfo:{...previous?.properties.rowInfo,...rowInfo},columnInfo:{...previous?.properties.columnInfo,...columnInfo},merges}};
      }
      if(!order.length)throw Error('Workbook has no worksheets');w={...w,styles,sheets,sheetOrder:order,properties:{...w.properties,...extension?.properties,name:o.name,activeSheetId:extension?.properties.activeSheetId&&order.includes(extension.properties.activeSheetId)?extension.properties.activeSheetId:order[0]!,dateSystem:x.properties.date1904?'1904':'1900'},names:extension?.names??[]};
      if(!extension)issues.push(issue('advanced objects','External charts, pivots, conditional formatting, validation, names and table definitions are not imported. Cell values, formulas and basic styles are imported.'));
    }
    const parsed=parseWorkbook(w,o.limits.workbook);return parsed.ok?{ok:true,value:{workbook:parsed.value,issues}}:parsed;
  }catch(error){return{ok:false,error:{code:o.signal?.aborted?'CANCELLED':'INVALID_INPUT',message:error instanceof Error?error.message:'Import failed'}};}
}
export async function exportWorkbook(w:Workbook,o:ExportOptions):Promise<Result<ExportResult>>{
 try{checkCancel(o.signal);if(o.cache.revision!==w.revision)throw Error('Calculation cache revision mismatch');const issues:CompatibilityIssue[]=[];
 const filename=w.properties.name.replace(/[^a-zA-Z0-9 _.-]/g,'_').slice(0,100)||'Workbook';
 const scalar=(id:SheetId,key:CellKey,cell:Cell):Scalar=>{if(cell.input.kind==='value')return cell.input.value;const v=o.cache.values[id]?.[key];if(v===undefined)throw Error('Missing calculated formula cache');return v;};
 if(o.file.format!=='xlsx'){
  const id=o.file.sheetId;if(!id||!w.sheets[id])throw Error('CSV/TSV export requires a sheet');const cells=[...entries(w,{sheetId:id,top:0,left:0,bottom:1048575,right:16383})];const range=o.file.range??{top:0,left:0,bottom:cells.reduce((max,c)=>Math.max(max,c.at.row),0),right:cells.reduce((max,c)=>Math.max(max,c.at.col),0)};if((range.bottom-range.top+1)*(range.right-range.left+1)>o.limits.workbook.maxAuthoredCells)throw Error('CSV bounding rectangle resource limit');
  const values=new Map(cells.map(({at,cell})=>[`${at.row}:${at.col}`,scalar(id,`${at.row}:${at.col}`,cell)]));const delimiter=o.file.format==='tsv'?'\t':o.file.delimiter==='\\t'?'\t':o.file.delimiter??',';const rows:string[]=[];
  for(let r=range.top;r<=range.bottom;r++){const row:string[]=[];for(let c=range.left;c<=range.right;c++){const v=values.get(`${r}:${c}`);let t=v===null||v===undefined?'':typeof v==='object'?v.code:String(v);if(o.file.csvEscapeFormulas&&typeof v==='string'&&/^[\s]*[=+@-]/.test(t))t="'"+t;row.push('"'+t.replaceAll('"','""')+'"');}rows.push(row.join(delimiter));}
  return{ok:true,value:{bytes:strToU8(rows.join('\r\n')),filename:filename+'.'+o.file.format,mediaType:o.file.format==='csv'?'text/csv':'text/tab-separated-values',issues}};
 }
 const x=new ExcelJS.Workbook();x.creator=w.properties.author||'OpenExcel';x.properties.date1904=w.properties.dateSystem==='1904';
 for(const id of w.sheetOrder){checkCancel(o.signal);const sheet=w.sheets[id]!;const ws=x.addWorksheet(sheet.properties.name,{state:sheet.properties.hidden?'hidden':'visible'});
  for(const {at,cell}of entries(w,{sheetId:id,top:0,left:0,bottom:1048575,right:16383})){const c=ws.getCell(at.row+1,at.col+1),value=scalar(id,`${at.row}:${at.col}`,cell);const excelValue=value&&typeof value==='object'?{error:(['#CIRC!','#PARSE!','#SPILL!','#CALC!'].includes(value.code)?'#VALUE!':value.code) as ExcelJS.CellErrorValue['error']}:value;
   c.value=cell.input.kind==='formula'?{formula:cell.input.source.replace(/^=/,''),...(excelValue!==null?{result:excelValue}:{})} as ExcelJS.CellFormulaValue:excelValue;
   const s=cell.styleId?w.styles[cell.styleId]:undefined;if(s){if(s.numberFormat)c.numFmt=s.numberFormat;if(s.font)c.font={...(s.font.family?{name:s.font.family}:{}),...(s.font.size?{size:s.font.size}:{}),bold:s.font.bold??false,italic:s.font.italic??false,underline:s.font.underline??false,strike:s.font.strikethrough??false,...(s.font.color?{color:{argb:'FF'+s.font.color.slice(1)}}:{})};if(s.borders){const border:Partial<ExcelJS.Borders>={};for(const side of ['top','right','bottom','left'] as const){const value=s.borders[side];if(value&&value.style!=='none')border[side]={style:value.style,color:{argb:'FF'+value.color.slice(1)}};}c.border=border;}if(s.fill)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+s.fill.slice(1)}};c.alignment={horizontal:s.horizontal==='general'?undefined:s.horizontal,vertical:s.vertical,wrapText:s.wrap,textRotation:s.rotation} as ExcelJS.Alignment;}
  }
  for(const [r,info]of Object.entries(sheet.properties.rowInfo)){const row=ws.getRow(Number(r)+1);if(info.size)row.height=info.size*3/4;row.hidden=info.hidden??false;}
  for(const [c,info]of Object.entries(sheet.properties.columnInfo)){const col=ws.getColumn(Number(c)+1);if(info.size)col.width=info.size/7;col.hidden=info.hidden??false;}
  for(const m of sheet.properties.merges)ws.mergeCells(m.top+1,m.left+1,m.bottom+1,m.right+1);
  for(const rule of sheet.properties.conditionalFormats){
    const ref=formatAddress({sheetId:id,row:rule.range.top,col:rule.range.left})+':'+formatAddress({sheetId:id,row:rule.range.bottom,col:rule.range.right});
    const threshold=(t:import('@openexcel/model').Threshold):ExcelJS.Cvfo=>({type:t.kind==='minimum'?'min':t.kind==='maximum'?'max':t.kind==='number'?'num':t.kind,...('value'in t?{value:t.value}:{})});
    let native:ExcelJS.ConditionalFormattingRule;
    if(rule.kind==='formula')native={type:'expression',priority:rule.priority,formulae:[rule.formula.replace(/^=/,'')],style:{...(rule.style.fill?{fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+rule.style.fill.slice(1)}}}:{}),...(rule.style.font?{font:{bold:rule.style.font.bold??false,italic:rule.style.font.italic??false,...(rule.style.font.color?{color:{argb:'FF'+rule.style.font.color.slice(1)}}:{})}}:{})}};
    else if(rule.kind==='colorScale')native={type:'colorScale',priority:rule.priority,cfvo:rule.stops.map(s=>threshold(s.threshold)),color:rule.stops.map(s=>({argb:'FF'+s.color.slice(1)}))};
    else if(rule.kind==='dataBar')native={type:'dataBar',priority:rule.priority,cfvo:[threshold(rule.min),threshold(rule.max)],showValue:rule.showValue,...{color:{argb:'FF'+rule.color.slice(1)}}};
    else {native={type:'iconSet',priority:rule.priority,iconSet:'3Arrows',cfvo:rule.thresholds.map(threshold),showValue:rule.showValue,reverse:rule.reverse};issues.push(issue('icon set','Custom icons are mapped to Excel 3Arrows.'));}
    ws.addConditionalFormatting({ref,rules:[native]});
    if(rule.stopIfTrue)issues.push(issue('conditional formatting','stopIfTrue is retained in OpenExcel metadata only.'));
  }
  ws.views=[{state:'frozen',xSplit:sheet.properties.view.freezeColumns,ySplit:sheet.properties.view.freezeRows}];
 }
 const files=unzipSync(new Uint8Array(await x.xlsx.writeBuffer()));addNativeCharts(files,w,o.cache,issues);files['openexcel/workbook.json']=strToU8(JSON.stringify(w));files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']!).replace('</Types>','<Override PartName="/openexcel/workbook.json" ContentType="application/json"/><Override PartName="/openexcel/manifest.json" ContentType="application/json"/></Types>'));files['openexcel/manifest.json']=strToU8(JSON.stringify({version:1,parts:nativeManifest(files)}));const bytes=zipSync(files);
 issues.push(issue('advanced objects','Pivots and advanced worksheet metadata survive OpenExcel round trips through a private extension. Native charts use basic axes; advanced axis styling and secondary axes are not emitted.'));
 return{ok:true,value:{bytes,filename:filename+'.xlsx',mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',issues}};
 }catch(error){return{ok:false,error:{code:o.signal?.aborted?'CANCELLED':'INVALID_INPUT',message:error instanceof Error?error.message:'Export failed'}};}
}
