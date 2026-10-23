import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createId,createWorkbook} from '@openexcel/model';
import type {Cell,CellKey,TileKey} from '@openexcel/model';

test('measure scrolling over 100,000 populated cells',async({page,request})=>{
 test.setTimeout(120000);
 const sheetId=createId('sheet');const blank=createWorkbook({id:createId('workbook'),sheetId,name:'100K scrolling benchmark',timestamp:new Date().toISOString()});
 const tiles:Partial<Record<TileKey,Partial<Record<CellKey,Cell>>>>={};
 for(let row=0;row<10000;row++)for(let col=0;col<10;col++){
  const tile:TileKey=`${Math.floor(row/128)}:0`;
  (tiles[tile]??={})[`${row}:${col}`]={input:{kind:'value',value:row*10+col}};
 }
 const workbook={...blank,sheets:{[sheetId]:{...blank.sheets[sheetId]!,tiles}}};
 const start=Date.now();
 const response=await request.post('/api/workbooks',{data:{kind:'snapshot',name:workbook.properties.name,workbook}});expect(response.ok(),await response.text()).toBe(true);
 await page.addInitScript(id=>localStorage.setItem('openexcel-last',id),workbook.id);
 await page.goto('/');await expect(page.getByRole('gridcell',{name:'J1 cell',exact:true})).toHaveText('9');
 const loadMs=Date.now()-start;
 const timing=await page.evaluate(async()=>{
  const grid=document.querySelector('[role="grid"]') as HTMLElement;
  const durations:number[]=[];let previous=performance.now();let maximumCells=0;
  for(let frame=0;frame<120;frame++){
   grid.scrollTop=frame*120;
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   const now=performance.now();durations.push(now-previous);previous=now;
   maximumCells=Math.max(maximumCells,document.querySelectorAll('[role="gridcell"]').length);
  }
  durations.sort((a,b)=>a-b);
  return {frames:durations.length,p50Ms:durations[Math.floor(durations.length*.5)],p95Ms:durations[Math.floor(durations.length*.95)],maxMs:durations.at(-1),maximumCells,framesOver50Ms:durations.filter(ms=>ms>50).length};
 });
 expect(timing.maximumCells).toBeLessThan(3000);
 // A wide regression ceiling detects a frozen UI without claiming a 60 FPS target.
 expect(timing.maxMs).toBeLessThan(2000);
 await mkdir('artifacts',{recursive:true});
 await writeFile('artifacts/browser-benchmark.json',JSON.stringify({timestamp:new Date().toISOString(),browser:'Playwright Chromium headless',viewport:{width:1440,height:1000},populatedCells:100000,loadIncludingApiMs:loadMs,...timing,notes:'One run, 120 requestAnimationFrame-driven scrolls. Includes automation and React work; does not model human wheel cadence. Target 60 FPS corresponds to ~16.7ms frames.'},null,2));
 await page.screenshot({path:'artifacts/openexcel-100k-cells.png'});
});
