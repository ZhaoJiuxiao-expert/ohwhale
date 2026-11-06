'use strict';
const zlib=require('node:zlib');
function decode(buffer){
 if(buffer[0]===0xff&&buffer[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(buffer.subarray(2));
 if(buffer[0]===0xfe&&buffer[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(buffer.subarray(2));
 try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw Error('文字编码不是 UTF-8 / UTF-16，请先另存为 UTF-8 文本');}
}
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
// Read only the bounded document.xml member; never extract archive paths to disk.
function documentXml(zip){
 let e=-1;for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50&&i+22+zip.readUInt16LE(i+20)===zip.length){e=i;break;}
 if(e<0||zip.readUInt16LE(e+4)||zip.readUInt16LE(e+6))throw Error('DOCX压缩结构无效');
 const count=zip.readUInt16LE(e+10),size=zip.readUInt32LE(e+12),start=zip.readUInt32LE(e+16);
 if(count===65535||count>10000||start+size>e||zip.readUInt16LE(e+8)!==count)throw Error('不支持此DOCX压缩结构');
 let p=start,found;
 for(let i=0;i<count;i++){
  if(p+46>start+size||zip.readUInt32LE(p)!==0x02014b50)throw Error('DOCX目录损坏');
  const n=zip.readUInt16LE(p+28),extra=zip.readUInt16LE(p+30),comment=zip.readUInt16LE(p+32),end=p+46+n+extra+comment;
  if(end>start+size)throw Error('DOCX目录长度无效');
  const name=zip.toString('utf8',p+46,p+46+n);
  if(name==='word/document.xml'){
   if(found)throw Error('DOCX存在重复正文');
   const flags=zip.readUInt16LE(p+8),method=zip.readUInt16LE(p+10),compressed=zip.readUInt32LE(p+20),length=zip.readUInt32LE(p+24),offset=zip.readUInt32LE(p+42);
   if(flags&1||![0,8].includes(method)||length>12*1024*1024||compressed>20*1024*1024||offset+30>start||zip.readUInt32LE(offset)!==0x04034b50)throw Error('DOCX正文加密、过大或格式不支持');
   const localName=zip.readUInt16LE(offset+26),localExtra=zip.readUInt16LE(offset+28),begin=offset+30+localName+localExtra;
   if(zip.toString('utf8',offset+30,offset+30+localName)!==name||begin+compressed>start)throw Error('DOCX正文位置无效');
   const raw=zip.subarray(begin,begin+compressed);
   const out=method===0?raw:zlib.inflateRawSync(raw,{maxOutputLength:12*1024*1024});
   if(out.length!==length||crc32(out)!==zip.readUInt32LE(p+16))throw Error('DOCX正文校验失败');
   found=decode(out);
  }
  p=end;
 }
 if(!found)throw Error('没有找到DOCX正文；不支持加密文档');
 return found;
}
function entities(s){return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,x)=>{
 if(x[0]==='#'){const n=x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):parseInt(x.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'\ufffd';}
 return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[x]||'';
});}
function extractNovel(buffer,extension){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>20*1024*1024)throw Error('小说文件须为20MB以内的TXT、MD或DOCX');
 let text;
 if(extension.toLowerCase()==='.docx'){
  const xml=documentXml(buffer);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('不接受含外部实体的DOCX');
  text=[...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map(p=>[...p[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)].map(m=>m[2]?(m[2]==='tab'?'\t':'\n'):entities(m[1])).join('')).join('\n');
 }else if(['.txt','.md'].includes(extension.toLowerCase()))text=decode(buffer);else throw Error('只支持TXT、MD与DOCX小说');
 text=text.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');
 if(!text.trim()||text.includes('\0')||text.length>1000000)throw Error('未读取到有效正文，或正文超过100万字符');
 return text;
}
module.exports={extractNovel,crc32};
