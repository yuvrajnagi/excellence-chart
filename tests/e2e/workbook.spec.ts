import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('edit, calculate, format, chart, persist and XLSX round trip',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');
 await expect(page.getByRole('grid')).toBeVisible();
 const cell=(address:string)=>page.getByRole('gridcell',{name:`${address} cell`,exact:true});
 const input=async(address:string,text:string)=>{await cell(address).click();await page.getByLabel('Formula bar',{exact:true}).fill(text);await page.getByLabel('Formula bar',{exact:true}).press('Enter');};
 await input('A1','Quarter');await input('B1','Revenue');await input('A2','Q1');await input('A3','Q2');await input('B2','120');await input('B3','180');await input('C2','=SUM(B2:B3)');
 await expect(cell('C2')).toHaveText('300');
 await cell('B2').click();await page.getByRole('button',{name:'Bold',exact:true}).click();await expect(cell('B2')).toHaveCSS('font-weight','700');
 await page.getByLabel('Name box',{exact:true}).fill('A1:B3');await page.getByLabel('Name box',{exact:true}).press('Enter');
 await page.getByRole('button',{name:'Insert',exact:true}).click();await page.getByRole('button',{name:'Insert chart',exact:true}).click();
 await expect(page.locator('svg').first()).toBeVisible();
 await input('B2','150');await expect(cell('C2')).toHaveText('330');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByText('Saved',{exact:true})).toBeVisible();
 await page.reload();await expect(cell('C2')).toHaveText('330');await expect(cell('B2')).toHaveCSS('font-weight','700');await expect(page.locator('svg').first()).toBeVisible();
 await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/openexcel-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'File',exact:true}).click();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export XLSX',exact:true}).click();const download=await downloadPromise;await download.saveAs('artifacts/browser-roundtrip.xlsx');
 await page.getByLabel('Import workbook',{exact:true}).setInputFiles('artifacts/browser-roundtrip.xlsx');
 await expect(cell('C2')).toHaveText('330');expect(errors).toEqual([]);
});

test('virtual grid reaches last address and supports undo',async({page})=>{
 await page.goto('/');await expect(page.getByRole('grid')).toBeVisible();
 await page.getByLabel('Name box',{exact:true}).fill('XFD1048576');await page.getByLabel('Name box',{exact:true}).press('Enter');
 const last=page.getByRole('gridcell',{name:'XFD1048576 cell',exact:true});await expect(last).toBeVisible();
 await page.getByLabel('Formula bar',{exact:true}).fill('42');await page.getByLabel('Formula bar',{exact:true}).press('Enter');await expect(last).toHaveText('42');
 expect(await page.getByRole('gridcell').count()).toBeLessThan(3000);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(last).toHaveText('');
 await page.setViewportSize({width:800,height:650});await page.screenshot({path:'artifacts/openexcel-compact.png'});
});
