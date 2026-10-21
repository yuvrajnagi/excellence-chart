import type { ErrorValue } from "@openexcel/model";
export type Ast = {kind:'literal';value:number|string|boolean|null|ErrorValue}|{kind:'ref';sheet?:string;row:number;col:number;absoluteRow:boolean;absoluteCol:boolean}|{kind:'name';name:string}|{kind:'range';from:Ast;to:Ast}|{kind:'binary';op:string;left:Ast;right:Ast}|{kind:'unary';op:string;arg:Ast}|{kind:'call';name:string;args:Ast[]}|{kind:'array';rows:Ast[][]};
type Token={text:string;start:number;end:number;kind:string};
export function tokenize(source:string):Token[]{
 const result:Token[]=[]; let p=source.startsWith('=')?1:0;
 while(p<source.length){if(/\s/.test(source[p]!)){p++;continue;} const start=p; const tail=source.slice(p);
 const m=/^(?:"(?:[^"]|"")*"|'(?:[^']|'')*'|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|#[A-Z0-9/?!]+|\$?[A-Za-z_][A-Za-z0-9_.$]*|<>|<=|>=|[+\-*/^&%=<>():,;{}!])/.exec(tail);if(!m)throw Error('Unexpected token');p+=m[0].length;
 const text=m[0];result.push({text,start,end:p,kind:text[0]==='"'?'string':text[0]==="'"?'quoted':/^\d|^\.\d/.test(text)?'number':'symbol'});
 }return result;
}
export function parseFormula(source:string):Ast{
 if(source.length>32768)throw Error('Formula too long'); const ts=tokenize(source);let i=0,depth=0;
 const peek=()=>ts[i]?.text; const take=()=>ts[i++];const expect=(x:string)=>{if(take()?.text!==x)throw Error('Expected '+x);};
 function atom():Ast {if(++depth>256)throw Error('Formula too deep');const t=take();if(!t)throw Error('Missing operand');let node:Ast;
 if(t.text==='+'||t.text==='-')node={kind:'unary',op:t.text,arg:expr(6)};
 else if(t.text==='('){node=expr(0);expect(')');}
 else if(t.text==='{'){const rows:Ast[][]=[[]];while(peek()!=='}'){rows.at(-1)!.push(expr(0));if(peek()===';'){take();rows.push([]);}else if(peek()===',')take();else break;}expect('}');if(rows.some(r=>r.length!==rows[0]!.length))throw Error('Ragged array');node={kind:'array',rows};}
 else if(t.kind==='number')node={kind:'literal',value:Number(t.text)};
 else if(t.kind==='string')node={kind:'literal',value:t.text.slice(1,-1).replace(/""/g,'"')};
 else if(/^#[A-Z0-9/?!]+$/.test(t.text))node={kind:'literal',value:{kind:'error',code:t.text as ErrorValue['code']}};
 else {let sheet:string|undefined;let text=t.text;if(peek()==='!'){take();sheet=text.replace(/^'|'$/g,'').replace(/''/g,"'");text=take()?.text??'';}
 if(peek()==='('){take();const args:Ast[]=[];while(peek()!==')'){args.push(peek()===','?{kind:'literal',value:null}:expr(0));if(peek()===',')take();else break;}expect(')');node={kind:'call',name:text.toUpperCase(),args};}
 else {const ref=/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(text);if(ref){let col=0;for(const c of ref[2]!.toUpperCase())col=col*26+c.charCodeAt(0)-64;node={kind:'ref',row:Number(ref[4])-1,col:col-1,absoluteCol:!!ref[1],absoluteRow:!!ref[3],...(sheet===undefined?{}:{sheet})};}
 else node=/^(TRUE|FALSE)$/i.test(text)?{kind:'literal',value:text.toUpperCase()==='TRUE'}:{kind:'name',name:text};}}
 depth--;return node;
 }
 function expr(min:number):Ast{let left=atom();while(true){const op=peek();if(op==='%'){take();left={kind:'unary',op:'%',arg:left};continue;}const prec=op=== ':'?8:op==='^'?7:op==='*'||op==='/'?5:op==='+'||op==='-'?4:op==='&'?3:op&&['=','<>','<','>','<=','>='].includes(op)?2:0;if(!prec||prec<min)break;take();const right=expr(prec+1);left=op===':'?{kind:'range',from:left,to:right}:{kind:'binary',op:op!,left,right};}return left;}
 const ast=expr(0);if(i!==ts.length)throw Error('Trailing input');return ast;
}
function letters(n:number){let s='';for(n++;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
/** Rewrite only reference tokens: quoted literals and sheet names are preserved. */
export function adjustFormulaReferences(source:string,rowDelta:number,colDelta:number):string{
 const ts=tokenize(source);let out='',p=0;for(let i=0;i<ts.length;i++){const t=ts[i]!;out+=source.slice(p,t.start);const m=/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(t.text);if(m&&ts[i+1]?.text!=='!'&&t.kind!=='string'){let col=0;for(const c of m[2]!.toUpperCase())col=col*26+c.charCodeAt(0)-64;col=col-1+(m[1]?0:colDelta);const row=Number(m[4])-1+(m[3]?0:rowDelta);out+=row<0||col<0||row>=1048576||col>=16384?'#REF!':m[1]+letters(col)+m[3]+String(row+1);}else out+=t.text;p=t.end;}return out+source.slice(p);
}
