'use strict';
class Buffer extends Uint8Array {
  static from(value,encoding='utf8'){if(typeof value==='string'){if(encoding==='base64')return new Buffer(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));if(encoding==='hex')return new Buffer(Uint8Array.from(value.match(/.{1,2}/g)||[],v=>parseInt(v,16)));return new Buffer(new TextEncoder().encode(value));}if(value instanceof ArrayBuffer)return new Buffer(new Uint8Array(value));return new Buffer(value);}
  static alloc(n){return new Buffer(n);}
  static byteLength(value,encoding){return Buffer.from(value,encoding).length;}
  static isBuffer(value){return value instanceof Buffer;}
  static concat(values){const result=new Buffer(values.reduce((n,v)=>n+v.length,0));let at=0;for(const v of values){result.set(v,at);at+=v.length;}return result;}
  subarray(start,end){return new Buffer(super.subarray(start,end));}
  toString(encoding='utf8'){if(encoding==='hex')return Array.from(this,v=>v.toString(16).padStart(2,'0')).join('');if(encoding==='base64'){let result='';for(let i=0;i<this.length;i+=8192)result+=String.fromCharCode(...this.subarray(i,i+8192));return btoa(result);}return new TextDecoder(encoding==='utf16le'?'utf-16le':'utf-8').decode(this);}
  readUInt16LE(at){return new DataView(this.buffer,this.byteOffset,this.byteLength).getUint16(at,true);}
  readUInt32LE(at){return new DataView(this.buffer,this.byteOffset,this.byteLength).getUint32(at,true);}
}
module.exports={Buffer};
