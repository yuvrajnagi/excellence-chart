import {strFromU8,strToU8} from 'fflate';
import {formatAddress,getCell} from '@openexcel/model';
import type {Workbook,RangeRef,CompatibilityIssue} from '@openexcel/model';
import type {ExportCache} from './index.js';
const xml=(s:unknown)=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const main='http://schemas.openxmlformats.org/drawingml/2006/main',chartNS='http://schemas.openxmlformats.org/drawingml/2006/chart';
/** Write standard OOXML charts with live range references and cached series values. */
export function addNativeCharts(files:Record<string,Uint8Array>,book:Workbook,cache:ExportCache,issues:CompatibilityIssue[]){
 let count=0;const content:string[]=[];
 const ref=(range:RangeRef)=>`'${book.sheets[range.sheetId]!.properties.name.replaceAll("'","''")}'!${formatAddress({sheetId:range.sheetId,row:range.top,col:range.left})}:${formatAddress({sheetId:range.sheetId,row:range.bottom,col:range.right})}`;
 const seriesRef=(range:RangeRef,numeric:boolean)=>{
  const values:unknown[]=[];for(let r=range.top;r<=range.bottom;r++)for(let c=range.left;c<=range.right;c++){if(values.length>=100000)throw Error('Chart point resource limit');const cell=getCell(book,{sheetId:range.sheetId,row:r,col:c});values.push(cell?.input.kind==='value'?cell.input.value:cache.values[range.sheetId]?.[`${r}:${c}`]??null);}
  const tag=numeric?'num':'str';return `<c:${tag}Ref><c:f>${xml(ref(range))}</c:f><c:${tag}Cache>${numeric?'<c:formatCode>General</c:formatCode>':''}<c:ptCount val="${values.length}"/>${values.map((v,i)=>`<c:pt idx="${i}"><c:v>${xml(numeric?(typeof v==='number'?v:0):v)}</c:v></c:pt>`).join('')}</c:${tag}Cache></c:${tag}Ref>`;
 };
 book.sheetOrder.forEach((id,sheetIndex)=>{
  const sheet=book.sheets[id]!,anchors:string[]=[],relations:string[]=[];
  for(const chart of sheet.properties.charts){
   const index=++count,rid=`rIdChart${index}`;
   const axes=!['pie','donut'].includes(chart.kind);
   const makeSer=(s:typeof chart.series[number],i:number,isScatter=false)=>`<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xml(s.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${xml(s.color.replace('#',''))}"/></a:solidFill></c:spPr>${isScatter?`<c:xVal>${seriesRef(s.xValues??s.categories??s.values,true)}</c:xVal><c:yVal>${seriesRef(s.values,true)}</c:yVal>`:`${s.categories?`<c:cat>${seriesRef(s.categories,false)}</c:cat>`:''}<c:val>${seriesRef(s.values,true)}</c:val>`}</c:ser>`;
   let plotCharts='';
   if(chart.kind==='combo'){
    const barSer=chart.series.slice(0,1).map((s,i)=>makeSer(s,i)).join('');
    const lineSer=chart.series.slice(1).map((s,i)=>makeSer(s,i+1)).join('');
    plotCharts=`<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${barSer}<c:axId val="100"/><c:axId val="200"/></c:barChart>`+(lineSer?`<c:lineChart><c:grouping val="standard"/>${lineSer}<c:axId val="100"/><c:axId val="200"/></c:lineChart>`:'');
   }else if(chart.kind==='histogram'){
    const rawValues:number[]=[];
    if(chart.series[0]?.values){const range=chart.series[0].values;for(let r=range.top;r<=range.bottom;r++)for(let c=range.left;c<=range.right;c++){const cell=getCell(book,{sheetId:range.sheetId,row:r,col:c});const raw=cell?.input.kind==='value'?cell.input.value:cache.values[range.sheetId]?.[`${r}:${c}`]??null;if(typeof raw==='number'&&Number.isFinite(raw))rawValues.push(raw);}}
    const lo=rawValues.length?Math.min(...rawValues):0,hi=rawValues.length?Math.max(...rawValues):1;
    const binCount=Math.min(20,Math.max(1,Math.ceil(Math.sqrt(rawValues.length||1))));
    const step=(hi-lo||1)/binCount;
    const bins=Array<number>(binCount).fill(0);for(const v of rawValues){const bin=Math.min(binCount-1,Math.floor((v-lo)/step));bins[bin]=(bins[bin]??0)+1;}
    const binLabels=bins.map((_,i)=>`${(lo+i*step).toFixed(1)}–${(lo+(i+1)*step).toFixed(1)}`);
    const s=chart.series[0]??{name:'Histogram',color:'#19876b'};
    const histSer=`<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(s.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${xml((s.color||'#19876b').replace('#',''))}"/></a:solidFill></c:spPr><c:cat><c:strLit><c:ptCount val="${binLabels.length}"/>${binLabels.map((l,i)=>`<c:pt idx="${i}"><c:v>${xml(l)}</c:v></c:pt>`).join('')}</c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${bins.length}"/>${bins.map((c,i)=>`<c:pt idx="${i}"><c:v>${c}</c:v></c:pt>`).join('')}</c:numLit></c:val></c:ser>`;
    plotCharts=`<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${histSer}<c:axId val="100"/><c:axId val="200"/></c:barChart>`;
   }else{
    const kind=chart.kind==='column'||chart.kind==='bar'?'barChart':chart.kind==='donut'?'doughnutChart':chart.kind+'Chart';
    const ser=chart.series.map((s,i)=>makeSer(s,i,chart.kind==='scatter')).join('');
    const configuration=kind==='barChart'?`<c:barDir val="${chart.kind==='bar'?'bar':'col'}"/><c:grouping val="${chart.stacked?'stacked':'clustered'}"/>`:kind==='lineChart'||kind==='areaChart'?`<c:grouping val="${chart.stacked?'stacked':'standard'}"/>`:kind==='scatterChart'?'<c:scatterStyle val="lineMarker"/>':'';
    plotCharts=`<c:${kind}>${configuration}${ser}${kind==='doughnutChart'?'<c:holeSize val="50"/>':''}${axes?'<c:axId val="100"/><c:axId val="200"/>':''}</c:${kind}>`;
   }
   const axis=(name:string,id:number,cross:number,pos:string)=>`<c:${name}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:${name}>`;
   const title=`<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${xml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
   files[`xl/charts/chart${index}.xml`]=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${chartNS}" xmlns:a="${main}"><c:chart>${title}<c:plotArea><c:layout/>${plotCharts}${axes?axis(chart.kind==='scatter'?'valAx':'catAx',100,200,'b')+axis('valAx',200,100,'l'):''}</c:plotArea>${chart.legend==='none'?'':`<c:legend><c:legendPos val="${({top:'t',bottom:'b',left:'l',right:'r'} as Record<string,string>)[chart.legend]??'b'}"/><c:overlay val="0"/></c:legend>`}<c:plotVisOnly val="${chart.showHidden?0:1}"/><c:dispBlanksAs val="${chart.blankAs==='zero'?'zero':'gap'}"/></c:chart></c:chartSpace>`);
   const a=chart.anchor;anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>${Math.round(a.offsetX*9525)}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${Math.round(a.offsetY*9525)}</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(a.width*9525)}" cy="${Math.round(a.height*9525)}"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index}" name="Chart ${index}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${chartNS}"><c:chart xmlns:c="${chartNS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`);
   relations.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index}.xml"/>`);
   content.push(`<Override PartName="/xl/charts/chart${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  }
  if(!anchors.length)return;
  const n=sheetIndex+1,drawing=`openexcelDrawing${n}`;
  files[`xl/drawings/${drawing}.xml`]=strToU8(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${main}">${anchors.join('')}</xdr:wsDr>`);
  files[`xl/drawings/_rels/${drawing}.xml.rels`]=strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`);
  content.push(`<Override PartName="/xl/drawings/${drawing}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  const path=`xl/worksheets/sheet${n}.xml`;files[path]=strToU8(strFromU8(files[path]!).replace('</worksheet>','<drawing r:id="rIdOpenExcelChart"/></worksheet>'));
  const relPath=`xl/worksheets/_rels/sheet${n}.xml.rels`,original=files[relPath]?strFromU8(files[relPath]!):'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  files[relPath]=strToU8(original.replace('</Relationships>',`<Relationship Id="rIdOpenExcelChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawing}.xml"/></Relationships>`));
 });
 files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']!).replace('</Types>',content.join('')+'</Types>'));
}
