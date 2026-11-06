'use strict';
function resolve(...parts){let result=[];for(const part of parts){if(typeof part!=='string')throw Error('路径须为文本');if(part.startsWith('/'))result=[];for(const token of part.split('/')){if(!token||token==='.')continue;if(token==='..'){if(!result.length)throw Error('路径越出应用目录');result.pop();}else{if(token.includes('\\')||token.includes('\0'))throw Error('路径无效');result.push(token);}}}return '/'+result.join('/');}
function join(...parts){return resolve(...parts);}
function dirname(value){const p=resolve(value);return p.slice(0,p.lastIndexOf('/'))||'/';}
function basename(value){return String(value).split('/').filter(Boolean).at(-1)||'';}
function extname(value){const name=basename(value),at=name.lastIndexOf('.');return at>0?name.slice(at):'';}
function relative(from,to){const a=resolve(from).split('/').filter(Boolean),b=resolve(to).split('/').filter(Boolean);let n=0;while(a[n]===b[n]&&n<a.length&&n<b.length)n++;return [...a.slice(n).map(()=> '..'),...b.slice(n)].join('/');}
module.exports={resolve,join,dirname,basename,extname,relative,isAbsolute:value=>typeof value==='string'&&value.startsWith('/'),sep:'/'};
