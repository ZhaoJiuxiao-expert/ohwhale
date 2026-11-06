'use strict';
// Ephemeral capability-authorized signaling. RTC chat/media never enter here.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {FriendsStore}=require('./friends.cjs');
const {ManagedAI}=require('./managed-ai.cjs');
const TOKEN=/^[A-Za-z0-9_-]{32,128}$/,ROOM=/^[a-f0-9]{32}$/;
const random=()=>crypto.randomBytes(32).toString('base64url');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function originURL(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('SIGNAL_PUBLIC_URL must be an HTTPS origin (loopback HTTP allowed for tests)');return u.origin;}
function createSignalingServer({ownerToken,turnSecret,turnUrls=[],publicUrl,origins=['null','https://localhost','capacitor://localhost','https://appassets.androidplatform.net'],roomTTL=300000,turnTTL=900000,maxRooms=100,trustProxy=false,now=Date.now,friendsDir,friendsLimits={},managedAI,managedAIOptions}={}){
 if(!TOKEN.test(ownerToken||'')||!TOKEN.test(turnSecret||''))throw Error('Owner token and TURN secret must each contain at least 32 random URL-safe characters');
 const publicOrigin=typeof publicUrl==='function'?()=>originURL(publicUrl()):()=>originURL(publicUrl);if(typeof publicUrl!=='function')publicOrigin();if(!Array.isArray(turnUrls)||turnUrls.length>8||turnUrls.some(x=>typeof x!=='string'||!/^(turn|turns|stun|stuns):[^\s@/#]+(?:\?transport=(udp|tcp))?$/.test(x)))throw Error('Invalid TURN URLs');
 if(!Number.isInteger(roomTTL)||roomTTL<1000||roomTTL>600000||!Number.isInteger(turnTTL)||turnTTL<1000||turnTTL>3600000)throw Error('Invalid capability lifetime');
 const rooms=new Map(),limits=new Map(),salt=random();let closed=false;
 let friends;
 function cleanup(){const time=now();for(const [id,r]of rooms)if(r.expiresAt<=time)rooms.delete(id);for(const [key,v]of limits)if(v.until<=time)limits.delete(key);friends?.cleanup();}
 const sweep=setInterval(cleanup,10000);sweep.unref();
 function rate(key,limit){const time=now();let v=limits.get(key);if(!v||v.until<=time){if(limits.size>=10000)return false;v={count:0,until:time+60000};limits.set(key,v);}return ++v.count<=limit;}
 function ice(roomId,role){const expiresAt=now()+turnTTL,username=Math.floor(expiresAt/1000)+':'+roomId+':'+role;return {iceServers:turnUrls.length?[{urls:[...turnUrls],username,credential:crypto.createHmac('sha1',turnSecret).update(username).digest('base64')}]:[],credentialExpiresAt:expiresAt};}
 function createRoom({ip,mode,policy,paired=false,expiresAt=now()+roomTTL}){
  expiresAt=Math.min(expiresAt,now()+roomTTL);
  cleanup();if(rooms.size>=maxRooms||[...rooms.values()].filter(r=>r.ip===ip).length>=5)throw {status:429,code:'ROOM_LIMIT',message:'服务器连接数量暂时已满'};
  const roomId=crypto.randomBytes(16).toString('hex'),secret=paired?'':random(),hostToken=random(),guestToken=paired?random():null;
  const room={ip,hostHash:digest(hostToken),joinHash:paired?'':digest(secret),guestHash:paired?digest(guestToken):null,expiresAt,mode,policy,offer:null,answer:null,ready:new Set()};rooms.set(roomId,room);
  const grant=(token,role)=>({roomId,token,expiresAt,mode,policy,...ice(roomId,role)});
  return {roomId,secret,host:grant(hostToken,'host'),guest:paired?grant(guestToken,'guest'):null};
 }
 if(friendsDir)friends=new FriendsStore({dir:friendsDir,now,limits:friendsLimits,destroyRoom:id=>rooms.delete(id),createPairedRoom:({ip,expiresAt})=>{const created=createRoom({ip,expiresAt,mode:'human',policy:'all',paired:true});return {serverUrl:publicOrigin(),host:created.host,guest:created.guest};}});
 if(!managedAI)managedAI=new ManagedAI(managedAIOptions);
 const server=http.createServer(async(req,res)=>{
  const requestOrigin=req.headers.origin;const allowed=requestOrigin===undefined||requestOrigin===publicOrigin()||origins.includes(requestOrigin);
  const send=(status,data,extraHeaders={})=>{if(res.destroyed||res.headersSent)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extraHeaders,...(requestOrigin&&allowed?{'Access-Control-Allow-Origin':requestOrigin,'Vary':'Origin'}:{})});res.end(JSON.stringify(data));};
  const error=(status,code,message)=>{if(status===429){const retryAfterSeconds=code==='CONCURRENT_LIMIT'?1:/DAILY|BUDGET/.test(code)?Math.max(1,Math.ceil((Date.parse(new Date(now()).toISOString().slice(0,10)+'T00:00:00Z')+86400000-now())/1000)):60;return send(status,{error:{code,message},retryAfterSeconds},{'Retry-After':String(retryAfterSeconds)});}return send(status,{error:{code,message}});};
  if(!allowed)return error(403,'ORIGIN_DENIED','此应用来源未获服务器许可');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':requestOrigin||'null','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'});return res.end();}
  let remote=req.socket.remoteAddress||'';
  if(trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof req.headers['x-forwarded-for']==='string')remote=req.headers['x-forwarded-for'].split(',')[0].trim();
  const ip=digest(salt+remote);cleanup();if(!rate('all:'+ip,240))return error(429,'RATE_LIMIT','请求过于频繁');
  if(req.url==='/health'&&req.method==='GET')return send(200,{ok:true,protocol:1,turnConfigured:turnUrls.some(x=>/^turns?:/.test(x))});
  const staticFiles={'/check':['check.html','text/html; charset=utf-8'],'/client/check.js':['check.js','text/javascript'],'/client/network.js':['../src/p2p/network.js','text/javascript'],'/client/peer.js':['../src/p2p/peer.js','text/javascript']};
  if(req.method==='GET'&&Object.hasOwn(staticFiles,req.url||'')){const [file,type]=staticFiles[req.url];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: http://127.0.0.1:*; object-src 'none'; base-uri 'none'"});return res.end(fs.readFileSync(path.join(__dirname,file)));}
  if(req.url?.includes('?')||req.url?.length>160)return error(404,'NOT_FOUND','房间不存在或已失效');
  const auth=typeof req.headers.authorization==='string'?req.headers.authorization.replace(/^Bearer /,''):'';
  async function body(max=220000){if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw {status:415,code:'JSON_REQUIRED'};const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw {status:413,code:'BODY_LIMIT'};parts.push(chunk);}let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{throw {status:400,code:'BAD_JSON'};}if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>['__proto__','constructor','prototype'].includes(k)))throw {status:400,code:'BAD_SCHEMA'};return value;}
  try{
   if(req.url?.startsWith('/v1/managed/')){
    if(req.url==='/v1/managed/models'&&req.method==='GET')return send(200,managedAI.models());
    if(!friends)return error(503,'FRIENDS_DISABLED','好友身份服务尚未启用');
    const principal=friends.authenticate(auth,remote);
    if(req.url==='/v1/managed/usage'&&req.method==='GET')return send(200,managedAI.usage(principal));
    if(req.url==='/v1/managed/chat/completions'&&req.method==='POST'){
     const input=await body(8*1024*1024),controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
     try{return send(200,await managedAI.chat({principal,ip:remote,input,signal:controller.signal}));}finally{res.off('close',abort);}
    }
    return error(404,'NOT_FOUND','没有这个托管服务操作');
   }
   if(req.url?.startsWith('/v1/friends')){
    if(!friends)return error(503,'FRIENDS_DISABLED','这个配对服务尚未启用好友功能');const match=/^\/v1\/friends\/(register|state|request|respond|block|call|respond-call|session|end-call)$/.exec(req.url);if(!match)return error(404,'NOT_FOUND','没有这个好友操作');
    try{const input=req.method==='POST'?await body(4096):{};return send(200,friends.handle(match[1],{method:req.method,token:auth,input,ip:remote,roomIP:ip}));}catch(e){return error(e.status||400,e.code||'BAD_SCHEMA',e.status?e.message:'好友请求格式无效');}
   }
   if(req.method==='POST'&&req.url==='/v1/rooms'){
    if(!equal(auth,ownerToken))return error(401,'UNAUTHORIZED','房间创建未获授权');if(!rate('create:'+ip,6)||[...rooms.values()].filter(r=>r.ip===ip).length>=5||rooms.size>=maxRooms)return error(429,'ROOM_LIMIT','创建房间过于频繁');
    const input=await body();if(Object.keys(input).some(k=>!['mode','policy'].includes(k))||!['human','agent'].includes(input.mode)||!['all','relay'].includes(input.policy))return error(400,'BAD_SCHEMA','房间模式无效');if(rooms.size>=maxRooms||[...rooms.values()].filter(r=>r.ip===ip).length>=5)return error(429,'ROOM_LIMIT','房间数量已达上限');
    if(input.policy==='relay'&&!turnUrls.some(x=>/^turns?:/.test(x)))return error(503,'TURN_UNAVAILABLE','服务器尚未配置TURN中继');
    const created=createRoom({ip,mode:input.mode,policy:input.policy}),code='OH1.'+Buffer.from(JSON.stringify({v:1,u:publicOrigin(),r:created.roomId,k:created.secret,e:created.host.expiresAt})).toString('base64url');
    return send(201,{...created.host,code});
   }
   const match=/^\/v1\/rooms\/([a-f0-9]{32})(?:\/(join|signal|ready))?$/.exec(req.url||'');if(!match)return error(404,'NOT_FOUND','房间不存在或已失效');
   const [,roomId,action]=match,room=rooms.get(roomId);
   if(action==='join'&&req.method==='POST'){
    if(!rate('join:'+ip,12))return error(429,'JOIN_LIMIT','尝试过于频繁');const input=await body();if(!room||Object.keys(input).some(k=>k!=='secret')||!TOKEN.test(input.secret||'')||!equal(digest(input.secret),room.joinHash))return error(404,'NOT_FOUND','房间不存在或已失效');
    if(room.guestHash)return error(409,'ROOM_USED','邀请已经被使用');const token=random();room.guestHash=digest(token);room.joinHash='';return send(200,{roomId,token,expiresAt:room.expiresAt,mode:room.mode,policy:room.policy,...ice(roomId,'guest')});
   }
   const role=room&&equal(digest(auth),room.hostHash)?'host':room&&room.guestHash&&equal(digest(auth),room.guestHash)?'guest':null;
   if(!room||!role)return error(404,'NOT_FOUND','房间不存在或已失效');
   if(!action&&req.method==='DELETE'){rooms.delete(roomId);return send(200,{closed:true});}
   if(action==='ready'&&req.method==='POST'){room.ready.add(role);if(room.ready.size===2)rooms.delete(roomId);return send(200,{accepted:true});}
   if(action==='signal'&&req.method==='GET')return send(200,{state:room.guestHash?'paired':'waiting',expiresAt:room.expiresAt,signal:role==='host'?room.answer:room.offer});
   if(action==='signal'&&req.method==='POST'){
    const input=await body(),expected=role==='host'?'offer':'answer';if(Object.keys(input).some(k=>!['type','code'].includes(k))||input.type!==expected||typeof input.code!=='string'||input.code.length>200000||!/^LY1\.[A-Za-z0-9_-]+$/.test(input.code))return error(400,'BAD_SIGNAL','信令格式或角色无效');
    if(expected==='offer'&&room.offer||expected==='answer'&&(!room.offer||room.answer))return error(409,'SIGNAL_USED','此信令阶段已经结束');room[expected]={type:expected,code:input.code};return send(200,{accepted:true});
   }
   return error(404,'NOT_FOUND','房间不存在或已失效');
  }catch(e){error(e.status||503,e.code||'REQUEST_FAILED',e.status?e.message:'服务暂不可用');}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=30;
 server.on('close',()=>{closed=true;clearInterval(sweep);friends?.close();rooms.clear();limits.clear();});
 return {server,friends,close:async()=>{if(closed)return;server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));},stats:()=>({rooms:rooms.size,rateBuckets:limits.size})};
}
if(require.main===module){let managedAIOptions={};if(process.env.MANAGED_AI_KEY_FILE&&process.env.MANAGED_AI_DATA_DIR){const file=process.env.MANAGED_AI_KEY_FILE,stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096||(process.platform!=='win32'&&((stat.mode&0o777)!==0o600||stat.uid!==1000)))throw Error('Managed key file must be private and owned by uid 1000');const data=fs.lstatSync(process.env.MANAGED_AI_DATA_DIR);if(!data.isDirectory()||data.isSymbolicLink()||(process.platform!=='win32'&&((data.mode&0o777)!==0o700||data.uid!==1000)))throw Error('Managed data directory must be private and owned by uid 1000');managedAIOptions={apiKey:fs.readFileSync(file,'utf8'),dir:process.env.MANAGED_AI_DATA_DIR};}const app=createSignalingServer({managedAIOptions,ownerToken:process.env.SIGNAL_OWNER_TOKEN,turnSecret:process.env.TURN_SHARED_SECRET,turnUrls:JSON.parse(process.env.TURN_URLS||'[]'),publicUrl:process.env.SIGNAL_PUBLIC_URL,origins:JSON.parse(process.env.SIGNAL_ORIGINS||'["null","https://localhost","capacitor://localhost","https://appassets.androidplatform.net"]'),trustProxy:process.env.SIGNAL_TRUST_PROXY==='true',friendsDir:process.env.FRIENDS_DATA_DIR||undefined});app.server.listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('OhWhale signaling ready on loopback; no request/message logging'));}
module.exports={createSignalingServer,originURL};
