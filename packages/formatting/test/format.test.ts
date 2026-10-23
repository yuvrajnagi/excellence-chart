import {describe,it,expect} from 'vitest';
import {formatValue,colorScale,styleToCSS} from '../src/index.js';
describe('number display',()=>{
  it.each([[1234.56,'#,##0.00','1,234.56'],[0.25,'0%','25%'],[123,'$0.00','$123.00'],[45292,'yyyy-mm-dd','2024-01-01'],[-12,'0;(0)','(12)'],[12.345,'0.00','12.35']] as const)('formats %s with %s',(value,format,expected)=>expect(formatValue(value,format)).toBe(expected));
  it('preserves error and blank distinctions',()=>{expect(formatValue(null)).toBe('');expect(formatValue({kind:'error',code:'#REF!'})).toBe('#REF!');expect(formatValue(true)).toBe('TRUE');});
  it('maps style and color scales',()=>{expect(styleToCSS({font:{bold:true},fill:'#FF0000'})).toEqual({fontWeight:'bold',backgroundColor:'#FF0000'});expect(colorScale(0,0,10,['#000000','#FFFFFF'])).toBe('#000000');expect(colorScale(5,0,10,['#000000','#FFFFFF'])).toBe('#808080');});
  it('maps strikethrough and combined text decorations',()=>{
    expect(styleToCSS({font:{strikethrough:true}})).toEqual({textDecoration:'line-through'});
    expect(styleToCSS({font:{underline:true,strikethrough:true}})).toEqual({textDecoration:'underline line-through'});
  });
});
