'use strict';
const {rpc,subscribe}=require('./native.cjs');
const {Buffer}=require('./buffer.cjs');
const {randomUUID}=require('./crypto.cjs');
// A separate native route resolves only friend-purpose, origin-bound handles.
// The existing model transport remains restricted to chat/completions.
function scopedFetch(method,url,options={}){return new Promise((resolve,reject)=>{
 const requestId=randomUUID();let done=false,status=0,headers={},size=0;const chunks=[];
 const finish=()=>{if(done)return;done=true;off();options.signal?.removeEventListener('abort',cancel);};
 const cancel=()=>{rpc('httpCancel',{requestId}).catch(()=>{});finish();reject(Error('好友请求已取消。'));};
 const off=subscribe(event=>{if(done||event.requestId!==requestId)return;
  if(event.type==='httpHeaders'){status=event.status;headers=event.headers;}
  else if(event.type==='httpChunk'){const bytes=Buffer.from(event.dataBase64,'base64');size+=bytes.length;if(size>(method==='managedHttpStart'?4*1024*1024:512*1024)){cancel();return;}chunks.push(bytes);}
  else if(event.type==='httpEnd'){finish();if(!status){reject(Error('好友服务回应不完整。'));return;}resolve(new Response(Buffer.concat(chunks),{status,headers}));}
  else if(event.type==='httpError'){finish();reject(Error('好友服务暂时连接不上，请稍后重试。'));}
 });
 if(options.signal?.aborted){cancel();return;}options.signal?.addEventListener('abort',cancel,{once:true});
 rpc(method,{requestId,url,method:options.method||'GET',headers:options.headers||{},body:options.body||''}).catch(()=>{finish();reject(Error('好友本机通道暂时不可用，请稍后重试。'));});
});}
const friendsFetch=(url,options)=>scopedFetch('friendsHttpStart',url,options);
const managedFetch=(url,options)=>scopedFetch('managedHttpStart',url,options);
module.exports={friendsFetch,managedFetch};
