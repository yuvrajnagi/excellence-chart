import {applyTransaction,createId,createWorkbook,parseCellInput} from '@openexcel/model';
import type {Workbook,Patch,Sheet,SheetId,CellStyle} from '@openexcel/model';

/** Build authored data through the same validated transaction boundary as the application. */
export function challengeWorkbook():Workbook {
 const timestamp='2026-01-01T00:00:00.000Z';const first=createId('sheet');
 let book=createWorkbook({id:createId('workbook'),sheetId:first,name:'Excel_Compatibility_Challenge',timestamp});
 const names=['Financial Model','Assumptions','Lookup Tables','Dynamic Arrays','Analysis','Errors'];
 const ids=names.map((_,i)=>i?createId('sheet'):first);const sheets:Record<string,Sheet>={};
 const base=book.sheets[first]!;
 for(let i=0;i<names.length;i++)sheets[ids[i]!] ={...base,id:ids[i]!,properties:{...base.properties,name:names[i]!,tabColor:['#217346','#4472C4','#ED7D31','#7030A0','#00A6A6','#C00000'][i]!}};
 book={...book,sheets,sheetOrder:ids};
 const header=createId('style'),money=createId('style'),date=createId('style'),percent=createId('style');
 const styles:Record<string,CellStyle>={
 [header]:{font:{bold:true,color:'#FFFFFF',size:12},fill:'#217346'},
 [money]:{numberFormat:'$#,##0.00;($#,##0.00)'},[date]:{numberFormat:'yyyy-mm-dd'},[percent]:{numberFormat:'0.0%'},
 };
 book={...book,styles};const patches:Patch[]=[];
 const put=(s:number,r:number,c:number,v:string|number,styleId?:typeof header)=>patches.push({kind:'cell',at:{sheetId:ids[s]!,row:r,col:c},cell:{input:parseCellInput(String(v),'1900'),...(styleId?{styleId}:{})}});
 [['Metric','Value'],['Revenue growth',0.12],['Cost ratio',0.58],['Tax rate',0.21],['Discount rate',0.08],['Initial revenue',120000],['Start date',46023]].forEach((row,r)=>row.forEach((v,c)=>put(1,r,c,v!,r===0?header:r===6?date:undefined)));
 ['Year','Revenue','Costs','Operating profit','Tax','Net profit'].forEach((v,c)=>put(0,0,c,v,header));
 for(let r=1;r<=5;r++){
  put(0,r,0,2025+r);put(0,r,1,r===1?"='Assumptions'!$B$6":`=B${r}*(1+'Assumptions'!$B$2)`,money);
  put(0,r,2,`=B${r+1}*'Assumptions'!$B$3`,money);put(0,r,3,`=B${r+1}-C${r+1}`,money);
  put(0,r,4,`=D${r+1}*'Assumptions'!$B$4`,money);put(0,r,5,`=D${r+1}-E${r+1}`,money);
 }
 put(0,7,0,'Net present value',header);put(0,7,1,"=NPV('Assumptions'!B5,F2:F6)",money);
 put(0,9,0,'Nested decision',header);put(0,9,1,'=IFERROR(IF(AVERAGE(F2:F6)>40000,"Healthy","Review"),"Check inputs")');
 [['SKU','Product','Price'],['P100','Notebook',12],['P200','Keyboard',75],['P300','Monitor',240]].forEach((row,r)=>row.forEach((v,c)=>put(2,r,c,v!,r===0?header:undefined)));
 put(2,6,0,'Exact lookup',header);put(2,6,1,'=XLOOKUP("P200",A2:A4,C2:C4)');put(2,7,1,'=VLOOKUP("P300",A2:C4,3,FALSE)');
 put(3,0,0,'Sequence',header);put(3,1,0,'=SEQUENCE(5,3,1,1)');put(3,0,4,'Filtered prices',header);put(3,1,4,"=FILTER('Lookup Tables'!C2:C4,'Lookup Tables'!C2:C4>20)");
 put(3,8,0,'LET calculation',header);put(3,9,0,'=LET(revenue,120000,cost,70000,revenue-cost)');
 [['Region','Quarter','Sales'],['North','Q1',120],['South','Q1',95],['North','Q2',160],['South','Q2',140],['North','Q1',30]].forEach((row,r)=>row.forEach((v,c)=>put(4,r,c,v!,r===0?header:undefined)));
 [['Region','Q1','Q2','Total'],['North',150,160,310],['South',95,140,235],['Total',245,300,545]].forEach((row,r)=>row.forEach((v,c)=>put(4,r,c+5,v!,r===0?header:undefined)));
 put(5,0,0,'Deliberate errors',header);put(5,1,0,'=1/0');put(5,2,0,'=UNKNOWNFUNCTION(1)');put(5,3,0,'=A5');put(5,4,0,'=A4');put(5,5,0,'=SQRT(-1)');put(5,6,0,'=IFERROR(A2,"Handled")');
 const financial=sheets[first]!;const chartId=createId('object');const axis={title:'',logarithmic:false,numberFormat:'General',gridlines:true};
 sheets[first]={...financial,properties:{...financial.properties,defaultColumnWidth:132,view:{...financial.properties.view,freezeRows:1},conditionalFormats:[{id:createId('object'),kind:'colorScale',range:{top:1,left:5,bottom:5,right:5},priority:1,stopIfTrue:false,stops:[{threshold:{kind:'minimum'},color:'#F8696B'},{threshold:{kind:'maximum'},color:'#63BE7B'}]}],charts:[{id:chartId,kind:'column',title:'Revenue and net profit',series:[1,5].map((col,i)=>({id:createId('object'),name:i?'Net profit':'Revenue',values:{sheetId:first,top:1,left:col,bottom:5,right:col},categories:{sheetId:first,top:1,left:0,bottom:5,right:0},axis:'primary' as const,color:i?'#4DAA77':'#4472C4'})),anchor:{row:12,col:0,offsetX:0,offsetY:0,width:650,height:300},axes:{x:{...axis,title:'Year'},y:{...axis,title:'USD'}},legend:'bottom',showHidden:false,blankAs:'gap',stacked:false,background:'#FFFFFF'}]}};
 const analysis=ids[4]!;sheets[analysis]={...sheets[analysis]!,properties:{...sheets[analysis]!.properties,pivots:[{id:createId('object'),name:'RegionalSales',source:{sheetId:analysis,top:0,left:0,bottom:5,right:2},destination:{sheetId:analysis,row:0,col:5},rows:[0],columns:[1],values:[{offset:2,aggregate:'sum',label:'Sales'}],filters:[],rowTotals:true,columnTotals:true,output:{sheetId:analysis,top:0,left:5,bottom:3,right:8},refreshedAtRevision:1}]}};
 const lookup=ids[2]!;sheets[lookup]={...sheets[lookup]!,properties:{...sheets[lookup]!.properties,tables:[{id:createId('object'),name:'ProductCatalog',range:{top:0,left:0,bottom:3,right:2},columns:[{id:createId('object'),name:'SKU'},{id:createId('object'),name:'Product'},{id:createId('object'),name:'Price'}],totalsRow:false,filter:{range:{top:0,left:0,bottom:3,right:2},header:true,columns:[]}}]}};
 book={...book,sheets};const result=applyTransaction(book,{id:createId('transaction'),baseRevision:0,label:'Compatibility challenge',timestamp,patches});if(!result.ok)throw Error(result.error.message);return result.value.workbook;
}
