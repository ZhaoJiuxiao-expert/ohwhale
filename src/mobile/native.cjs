'use strict';
let host=globalThis.OhWhaleNative;
const pending=new Map(),listeners=new Set();let counter=0;
function setHost(value){host=value;}
function sync(method,input={}){if(!host)throw Error('Android 本机服务尚未就绪');const result=JSON.parse(host.sync(method,JSON.stringify(input)));if(!result.ok){const error=Error(result.error||'本机操作未完成');error.code=result.code;throw error;}return result.value;}
function rpc(method,input={}){return new Promise((resolve,reject)=>{if(!host){reject(Error('Android 本机服务尚未就绪'));return;}const id='rpc-'+(++counter);pending.set(id,{resolve,reject});host.postMessage(JSON.stringify({id,method,input}));});}
function receive(message){const event=typeof message==='string'?JSON.parse(message):message;if(event.type==='rpc'){const item=pending.get(event.id);if(!item)return;pending.delete(event.id);event.ok?item.resolve(event.value):item.reject(Error(event.error||'本机操作未完成'));}else for(const listener of listeners)listener(event);}
globalThis.__ohwhaleNativeEvent=receive;
function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
module.exports={sync,rpc,receive,subscribe,setHost};
