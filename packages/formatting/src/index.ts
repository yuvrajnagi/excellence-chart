import type { CellStyle, Scalar } from '@openexcel/model';

/** Number formats are interpreted as data. No generated CSS or JavaScript is evaluated. */
export function formatValue(value: Scalar, format = 'General'): string {
  if (value === null) return '';
  if (typeof value === 'object') return value.code;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value !== 'number') return value;
  if (!Number.isFinite(value)) return '#NUM!';
  if (format === 'General' || format === '@') return String(Number(value.toPrecision(12)));
  const section = format.split(';')[value < 0 ? 1 : value === 0 ? 2 : 0] ?? format.split(';')[0] ?? format;
  if (/[ymd]/i.test(section.replace(/"[^"]*"/g, ''))) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    if (!Number.isFinite(date.getTime())) return '#NUM!';
    const year = String(date.getUTCFullYear()); const month = date.getUTCMonth() + 1; const day = date.getUTCDate();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return section.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, token => {
      switch (token.toLowerCase()) {
        case 'yyyy': return year; case 'yy': return year.slice(-2);
        case 'mmmm': return date.toLocaleString('en-US', { month:'long', timeZone:'UTC' });
        case 'mmm': return months[month-1]!; case 'mm': return String(month).padStart(2,'0');
        case 'm': return String(month); case 'dd': return String(day).padStart(2,'0'); default: return String(day);
      }
    }).replace(/"/g,'');
  }
  const decimals = Math.min(20, section.match(/\.([0#]+)/)?.[1]?.length ?? 0);
  if (/E[+-]0/i.test(section)) return value.toExponential(decimals).replace('e','E');
  const percent = section.includes('%'); const currency = section.match(/[$€£¥]/)?.[0] ?? '';
  const magnitude = format.includes(';') && value < 0 ? Math.abs(value) : value;
  let result = (magnitude * (percent ? 100 : 1)).toLocaleString('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: section.includes(','),
  });
  result = currency + result + (percent ? '%' : '');
  if (value < 0 && section.includes('(')) result = `(${result.replace('-','')})`;
  const literal = section.match(/"([^"]*)"/)?.[1];
  return result + (literal ?? '');
}
export function styleToCSS(style: CellStyle = {}): Record<string, string | number> {
  const css: Record<string, string | number> = {};
  if(style.font?.family) css['fontFamily'] = style.font.family;
  if(style.font?.size) css['fontSize'] = `${style.font.size}pt`;
  if(style.font?.bold) css['fontWeight'] = 'bold';
  if(style.font?.italic) css['fontStyle'] = 'italic';
  const decorations: string[] = [];
  if(style.font?.underline) decorations.push('underline');
  if(style.font?.strikethrough) decorations.push('line-through');
  if(decorations.length) css['textDecoration'] = decorations.join(' ');
  if(style.font?.color) css['color'] = style.font.color;
  if(style.fill) css['backgroundColor'] = style.fill;
  if(style.horizontal && style.horizontal !== 'general') css['textAlign'] = style.horizontal;
  if(style.vertical) css['alignContent'] = {top:'start',middle:'center',bottom:'end'}[style.vertical];
  if(style.wrap) { css['whiteSpace']='normal'; css['overflowWrap']='anywhere'; }
  if(style.rotation) css['transform'] = `rotate(${-style.rotation}deg)`;
  for(const [edge,border] of Object.entries(style.borders ?? {})) {
    const width = border.style === 'thick' ? 3 : border.style === 'medium' ? 2 : 1;
    const line = ['dashed','dotted','double','none'].includes(border.style) ? border.style : 'solid';
    css[`border${edge[0]!.toUpperCase()}${edge.slice(1)}`] = `${width}px ${line} ${border.color}`;
  }
  return css;
}
export function colorScale(value: number, minimum: number, maximum: number, colors = ['#F8696B','#FFEB84','#63BE7B']): string {
  const fraction = maximum === minimum ? 0.5 : Math.min(1,Math.max(0,(value-minimum)/(maximum-minimum)));
  const position = fraction*(colors.length-1); const index = Math.min(colors.length-2,Math.floor(position));
  const a = colors[index] ?? '#FFFFFF'; const b = colors[index+1] ?? a; const t=position-index;
  return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
}
