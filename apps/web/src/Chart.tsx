import type { ChartDefinition, CellAddress, Scalar } from '@openexcel/model';
export function Chart({chart,value,onEdit,onDelete}:{chart:ChartDefinition;value:(at:CellAddress)=>Scalar;onEdit:()=>void;onDelete:()=>void}){
 let series=chart.series.map(s=>({...s,data:Array.from({length:Math.min(1000,s.values.bottom-s.values.top+1)},(_,i)=>Number(value({sheetId:s.values.sheetId,row:s.values.top+i,col:s.values.left}))||0)}));
 let binLabels:string[]|undefined;
 if(chart.kind==='histogram'){
  const source=series[0];if(source){const lo=Math.min(...source.data),hi=Math.max(...source.data),count=Math.min(20,Math.max(1,Math.ceil(Math.sqrt(source.data.length))));const step=(hi-lo||1)/count;
   const bins=Array<number>(count).fill(0);for(const v of source.data){const bin=Math.min(count-1,Math.floor((v-lo)/step));bins[bin]=(bins[bin]??0)+1;}
   binLabels=bins.map((_,i)=>`${(lo+i*step).toFixed(1)}–${(lo+(i+1)*step).toFixed(1)}`);series=[{...source,data:bins}];
  }
 }
 const all=series.flatMap(s=>s.data);const min=Math.min(chart.axes.y.min??0,...all),max=Math.max(chart.axes.y.max??1,...all),span=max-min||1;
 const n=Math.max(1,...series.map(s=>s.data.length));const x=(i:number)=>48+(i+.5)*360/n,y=(v:number)=>190-(v-min)/span*145;
 const colors=['#19876b','#539ee3','#ebaf48','#9c71d4','#ed8090','#5fc5c3'];
 const first=series[0];const labels=binLabels??(first?.categories?Array.from({length:n},(_,i)=>String(value({sheetId:first.categories!.sheetId,row:first.categories!.top+i,col:first.categories!.left})??'')):Array.from({length:n},(_,i)=>String(i+1)));
 const xs=series.flatMap(s=>s.xValues?s.data.map((_,i)=>Number(value({sheetId:s.xValues!.sheetId,row:s.xValues!.top+i,col:s.xValues!.left}))||0):[]);const xmin=Math.min(0,...xs),xspan=Math.max(1,...xs)-xmin;
 let angle=-Math.PI/2;const total=first?.data.reduce((a,b)=>a+Math.max(0,b),0)||1;
 return <section className="chart-card" aria-label={`${chart.kind} chart: ${chart.title}`} style={{background:chart.background}}>
 <div className="chart-title"><strong onDoubleClick={onEdit}>{chart.title}</strong><button aria-label="Edit chart" onClick={onEdit}>✎</button><button aria-label="Delete chart" onClick={onDelete}>×</button></div>
 <svg viewBox="0 0 450 235" role="img" aria-label={chart.title}>
 {['pie','donut'].includes(chart.kind)?<g>{first?.data.map((v,i)=>{const start=angle;angle+=Math.max(0,v)/total*Math.PI*2;const end=angle;const d=`M 225 110 L ${225+85*Math.cos(start)} ${110+85*Math.sin(start)} A 85 85 0 ${end-start>Math.PI?1:0} 1 ${225+85*Math.cos(end-.00001)} ${110+85*Math.sin(end-.00001)} Z`;return <path key={i} d={d} fill={colors[i%colors.length]}><title>{labels[i]}: {v}</title></path>;})}{chart.kind==='donut'&&<circle cx="225" cy="110" r="48" fill={chart.background}/>}</g>:<g>
 {[0,1,2,3,4].map(i=><g key={i}><line x1="48" x2="415" y1={190-i*36.25} y2={190-i*36.25} stroke="#e8edf0"/><text x="40" y={194-i*36.25} textAnchor="end" fontSize="9" fill="#6b7a82">{(min+span*i/4).toLocaleString(undefined,{maximumFractionDigits:1})}</text></g>)}
 {series.map((s,si)=>{const kind=chart.kind==='combo'?(si===0?'column':'line'):chart.kind;const points=s.data.map((v,i)=>`${x(i)},${y(v)}`).join(' ');return <g key={s.id}>
 {(kind==='line'||kind==='area')&&<>{kind==='area'&&<polygon points={`${x(0)},190 ${points} ${x(n-1)},190`} fill={s.color} opacity=".15"/>}<polyline points={points} stroke={s.color} strokeWidth="2.5" fill="none"/></>}
 {s.data.map((v,i)=>kind==='bar'?<rect key={i} x="48" y={45+i*145/n+si*10} width={Math.max(0,(v-min)/span*360)} height={Math.max(3,120/n/series.length)} fill={s.color}><title>{labels[i]}: {v}</title></rect>:['column','histogram'].includes(kind)?<rect key={i} x={x(i)-140/n+si*280/n/series.length} y={Math.min(y(v),y(0))} width={Math.max(1,260/n/series.length)} height={Math.max(1,Math.abs(y(0)-y(v)))} rx="2" fill={s.color}><title>{labels[i]}: {v}</title></rect>:<circle key={i} cx={kind==='scatter'&&s.xValues?48+((Number(value({sheetId:s.xValues.sheetId,row:s.xValues.top+i,col:s.xValues.left}))||0)-xmin)/xspan*360:x(i)} cy={y(v)} r="3" fill={s.color}><title>{labels[i]}: {v}</title></circle>)}
 </g>;})}
 {labels.map((label,i)=>i%Math.max(1,Math.ceil(n/8))===0&&<text key={i} x={x(i)} y="207" textAnchor="middle" fontSize="9" fill="#6b7a82">{label.slice(0,12)}</text>)}
 <text x="225" y="231" textAnchor="middle" fontSize="10" fill="#6b7a82">{chart.axes.x.title}</text>
 </g>}
 </svg>
 {chart.legend!=='none'&&<div className="chart-legend">{series.map(s=><span key={s.id}><i style={{background:s.color}}/>{s.name}</span>)}</div>}
 </section>;
}
