'use strict';
const {sync}=require('./native.cjs');const {Buffer}=require('./buffer.cjs');
function randomBytes(n){const b=new Buffer(n);globalThis.crypto.getRandomValues(b);return b;}
function randomUUID(){if(globalThis.crypto.randomUUID)return globalThis.crypto.randomUUID();const b=randomBytes(16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function createHash(algorithm){if(algorithm!=='sha256')throw Error('不支持的摘要算法');const chunks=[];return {update(value,encoding){chunks.push(typeof value==='string'?Buffer.from(value,encoding):Buffer.from(value));return this;},digest(encoding){const hex=sync('sha256',{dataBase64:Buffer.concat(chunks).toString('base64')});return encoding==='hex'?hex:Buffer.from(hex,'hex');}};}
module.exports={randomBytes,randomUUID,createHash};
