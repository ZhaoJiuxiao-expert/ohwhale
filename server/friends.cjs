'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/,TOKEN=/^[A-Za-z0-9_-]{43}$/,CODE=/^JW-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',ZERO=Buffer.alloc(32);
function failure(status,code,message){const error=Error(message);Object.assign(error,{status,code});throw error;}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))throw Error('Invalid friends schema');}
function displayName(value){if(typeof value!=='string'||value.trim()!==value||!value.length||value.length>60||/[\x00-\x1f\x7f/\\:]/.test(value)||value.includes('..'))failure(400,'BAD_SCHEMA','昵称需要1至60字，且不能包含路径或控制字符');return value;}
const hex=()=>crypto.randomBytes(16).toString('hex'),digest=value=>crypto.createHash('sha256').update(value).digest('hex'),pair=(a,b)=>[a,b].sort().join(':'),clone=value=>JSON.parse(JSON.stringify(value));
const LIMITS={maxIdentities:1000,maxContacts:100,maxRelationships:10000,maxRequests:1000,maxPending:30,maxBlocks:10000,maxSnapshots:2048,maxSnapshotBytes:4*1024*1024,maxCalls:100,registerPerMinute:5,registerPerDay:20};
class FriendsStore{
 constructor({dir,now=Date.now,createPairedRoom,destroyRoom,limits={}}){
  this.now=now;this.limits={...LIMITS,...limits};for(const value of Object.values(this.limits))if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid friends limit');
  this.createPairedRoom=createPairedRoom;this.destroyRoom=destroyRoom;this.presence=new Map();this.calls=new Map();this.rates=new Map();this.failed=false;
  this.dir=path.resolve(dir);if(!fs.existsSync(this.dir))fs.mkdirSync(this.dir,{recursive:true,mode:0o700});const stat=fs.lstatSync(this.dir);if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform==='linux'&&((stat.mode&0o777)!==0o700||stat.uid!==process.getuid()))throw Error('Friends data directory must be private, writable by the service uid, and not a symlink');
  this.dir=fs.realpathSync(this.dir);const entries=fs.readdirSync(this.dir);if(entries.some(name=>!/^snapshot-\d{12}\.json$/.test(name)))throw Error('Unexpected file in friends data directory; preserve and inspect it');
  this.revision=0;this.graph={schema:1,revision:0,ipSecret:crypto.randomBytes(32).toString('hex'),identities:[],relationships:[],requests:[],blocks:[]};
  if(entries.length){entries.sort();if(entries.length>this.limits.maxSnapshots)throw Error('Friends snapshot capacity exceeded');let previous=0;for(const name of entries){const number=Number(name.slice(9,21));if(!Number.isSafeInteger(number)||number<=previous)throw Error('Invalid friends snapshot sequence');previous=number;}
   const file=path.join(this.dir,entries.at(-1)),info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>this.limits.maxSnapshotBytes||process.platform==='linux'&&(info.mode&0o777)!==0o600)throw Error('Friends latest snapshot permissions/size invalid');
   try{this.graph=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)));this.validate(this.graph);if(this.graph.revision!==previous)throw Error('revision');}catch{throw Error('Latest friends snapshot corrupt; data retained, service not opened');}this.revision=previous;
  }
  this.index();
 }
 validate(g){
  exact(g,['schema','revision','ipSecret','identities','relationships','requests','blocks']);if(g.schema!==1||!Number.isSafeInteger(g.revision)||g.revision<0||!HASH.test(g.ipSecret)||['identities','relationships','requests','blocks'].some(k=>!Array.isArray(g[k])))throw Error('Invalid graph');
  const l=this.limits;if(g.identities.length>l.maxIdentities||g.relationships.length>l.maxRelationships||g.requests.length>l.maxRequests||g.blocks.length>l.maxBlocks)throw Error('Graph limit');const ids=new Set(),codes=new Set(),hashes=new Set();
  for(const identity of g.identities){exact(identity,['id','code','name','tokenHash','createdAt','registrationIp']);if(!ID.test(identity.id)||!CODE.test(identity.code)||!HASH.test(identity.tokenHash)||!HASH.test(identity.registrationIp)||!Number.isSafeInteger(identity.createdAt)||identity.createdAt<0||ids.has(identity.id)||codes.has(identity.code)||hashes.has(identity.tokenHash))throw Error('Invalid identity');displayName(identity.name);ids.add(identity.id);codes.add(identity.code);hashes.add(identity.tokenHash);}
  const known=(a,b)=>ID.test(a)&&ID.test(b)&&a!==b&&ids.has(a)&&ids.has(b),blocked=new Set(),edges=new Set(),counts=new Map(),pending=new Map(),requestIds=new Set(),directions=new Set();
  for(const b of g.blocks){exact(b,['from','to']);if(!known(b.from,b.to)||blocked.has(b.from+':'+b.to))throw Error('Invalid block');blocked.add(b.from+':'+b.to);}
  for(const e of g.relationships){exact(e,['a','b']);if(!known(e.a,e.b)||e.a>=e.b||edges.has(pair(e.a,e.b))||blocked.has(e.a+':'+e.b)||blocked.has(e.b+':'+e.a))throw Error('Invalid edge');edges.add(pair(e.a,e.b));for(const id of [e.a,e.b]){counts.set(id,(counts.get(id)||0)+1);if(counts.get(id)>l.maxContacts)throw Error('Contacts limit');}}
  for(const r of g.requests){exact(r,['id','from','to','createdAt']);const direction=r.from+':'+r.to;if(!ID.test(r.id)||!known(r.from,r.to)||!Number.isSafeInteger(r.createdAt)||r.createdAt<0||requestIds.has(r.id)||directions.has(direction)||edges.has(pair(r.from,r.to))||blocked.has(direction)||blocked.has(r.to+':'+r.from))throw Error('Invalid request');requestIds.add(r.id);directions.add(direction);for(const key of ['out:'+r.from,'in:'+r.to]){pending.set(key,(pending.get(key)||0)+1);if(pending.get(key)>l.maxPending)throw Error('Pending limit');}}
 }
 index(){this.ids=new Map(this.graph.identities.map(i=>[i.id,i]));this.codes=new Map(this.graph.identities.map(i=>[i.code,i.id]));this.tokens=new Map(this.graph.identities.map(i=>[i.tokenHash,i.id]));}
 commit(next){
  if(this.failed)failure(503,'STORE_UNAVAILABLE','好友资料暂时不能写入，现有文件已保留');if(this.revision>=this.limits.maxSnapshots)failure(503,'LIMIT','好友资料版本容量已满，请联系部署者保留备份后处理');
  next.revision=this.revision+1;this.validate(next);const raw=Buffer.from(JSON.stringify(next)+'\n');if(raw.length>this.limits.maxSnapshotBytes)failure(503,'LIMIT','好友资料已达服务器容量上限');
  const file=path.join(this.dir,'snapshot-'+String(next.revision).padStart(12,'0')+'.json');let fd;
  try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;if(process.platform==='linux'){const directory=fs.openSync(this.dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}}catch{if(fd!==undefined)fs.closeSync(fd);this.failed=true;failure(503,'STORE_UNAVAILABLE','好友资料写入未完成，文件已保留，请联系部署者检查');}
  this.graph=next;this.revision=next.revision;this.index();
 }
 limit(key,count,window=60000){const now=this.now();let value=this.rates.get(key);if(!value||value.until<=now){if(this.rates.size>=10000)failure(429,'RATE_LIMIT','请求有些密集，请稍后再试');value={count:0,until:now+window};this.rates.set(key,value);}if(++value.count>count)failure(429,'RATE_LIMIT','请求有些密集，请稍后再试');}
 ip(value){return crypto.createHmac('sha256',this.graph.ipSecret).update(String(value).slice(0,256)).digest('hex');}
 authenticate(token,ip){const hash=digest(typeof token==='string'?token:''),id=this.tokens.get(hash),expected=id?Buffer.from(this.ids.get(id).tokenHash,'hex'):ZERO;const valid=typeof token==='string'&&TOKEN.test(token)&&Buffer.from(token,'base64url').length===32&&crypto.timingSafeEqual(Buffer.from(hash,'hex'),expected);if(!valid||!id){this.limit('bad-auth:'+this.ip(ip),30);failure(401,'UNAUTHORIZED','这台设备的好友身份尚未授权');}return Object.freeze(this.public(id));}
 public(id){const i=this.ids.get(id);return {id:i.id,code:i.code,name:i.name};}
 edge(a,b){return this.graph.relationships.some(e=>pair(e.a,e.b)===pair(a,b));}
 blocked(a,b){return this.graph.blocks.some(e=>e.from===a&&e.to===b||e.from===b&&e.to===a);}
 cleanup(){const now=this.now();for(const [id,time]of this.presence)if(time<=now-60000)this.presence.delete(id);for(const [id,call]of this.calls)if(call.expiresAt<=now){if(call.session)this.destroyRoom(call.session.host.roomId);this.calls.delete(id);}for(const [key,value]of this.rates)if(value.until<=now)this.rates.delete(key);}
 online(id){return (this.presence.get(id)??-Infinity)>this.now()-60000;}
 removeCalls(a,b){for(const [id,c]of this.calls)if(pair(c.from,c.to)===pair(a,b)){if(c.session)this.destroyRoom(c.session.host.roomId);this.calls.delete(id);}}
 state(self){this.presence.set(self.id,this.now());return {self:this.public(self.id),contacts:this.graph.relationships.filter(e=>e.a===self.id||e.b===self.id).map(e=>{const id=e.a===self.id?e.b:e.a;return {...this.public(id),online:this.online(id)};}),requests:{incoming:this.graph.requests.filter(r=>r.to===self.id).map(r=>({id:r.id,from:this.public(r.from),createdAt:r.createdAt})),outgoing:this.graph.requests.filter(r=>r.from===self.id).map(r=>({id:r.id,to:this.public(r.to),createdAt:r.createdAt}))},calls:[...this.calls.values()].filter(c=>c.from===self.id||c.to===self.id).map(c=>({id:c.id,peer:this.public(c.from===self.id?c.to:c.from),direction:c.from===self.id?'outgoing':'incoming',status:c.status,expiresAt:c.expiresAt}))};}
 handle(action,{method,token,input={},ip,roomIP}){
  this.cleanup();const address=this.ip(ip);
  if(action==='register'){
   if(method!=='POST')failure(405,'BAD_METHOD','请使用正确的好友操作');this.limit('register:'+address,this.limits.registerPerMinute);exact(input,['name']);const name=displayName(input.name);
   if(this.graph.identities.length>=this.limits.maxIdentities||this.graph.identities.filter(i=>i.registrationIp===address&&i.createdAt>this.now()-86400000).length>=this.limits.registerPerDay)failure(429,'LIMIT','服务器注册额度暂时已满');
   let id,code;do{id=hex();}while(this.ids.has(id));do{const bytes=crypto.randomBytes(12),text=[...bytes].map(n=>ALPHABET[n&31]).join('');code='JW-'+text.match(/.{4}/g).join('-');}while(this.codes.has(code));const credential=crypto.randomBytes(32).toString('base64url'),next=clone(this.graph);next.identities.push({id,code,name,tokenHash:digest(credential),createdAt:this.now(),registrationIp:address});this.commit(next);return {self:this.public(id),token:credential};
  }
  const self=this.authenticate(token,ip);this.limit('identity:'+self.id,120);
  if(action==='state'){if(method!=='GET')failure(405,'BAD_METHOD','请使用正确的好友操作');return this.state(self);}
  if(method!=='POST')failure(405,'BAD_METHOD','请使用正确的好友操作');
  this.limit(action+':'+self.id,action==='request'?10:action==='call'?6:60);
  if(action==='request'){
   exact(input,['code']);if(!CODE.test(input.code))failure(400,'BAD_SCHEMA','请检查完整的鲸鲸号');const target=this.codes.get(input.code);if(!target||this.blocked(self.id,target))failure(404,'NOT_FOUND','暂时不能向这个鲸鲸号发送请求');if(target===self.id)failure(400,'CONFLICT','不能添加自己的鲸鲸号');if(this.edge(self.id,target)||this.graph.requests.some(r=>r.from===self.id&&r.to===target))return {ok:true};
   if(this.graph.requests.length>=this.limits.maxRequests||this.graph.requests.filter(r=>r.from===self.id).length>=this.limits.maxPending||this.graph.requests.filter(r=>r.to===target).length>=this.limits.maxPending)failure(429,'LIMIT','好友请求数量暂时已满');
   const next=clone(this.graph);next.requests.push({id:hex(),from:self.id,to:target,createdAt:this.now()});this.commit(next);return {ok:true};
  }
  if(action==='respond'){
   exact(input,['requestId','accept']);if(!ID.test(input.requestId)||typeof input.accept!=='boolean')failure(400,'BAD_SCHEMA','好友请求格式不完整');const request=this.graph.requests.find(r=>r.id===input.requestId);if(!request)failure(404,'NOT_FOUND','好友请求已失效');if(request.to!==self.id)failure(403,'FORBIDDEN','只能处理发给自己的好友请求');const next=clone(this.graph);
   if(input.accept){if(this.blocked(request.from,request.to))failure(404,'NOT_FOUND','好友请求已失效');const counts=id=>this.graph.relationships.filter(e=>e.a===id||e.b===id).length;if(this.graph.relationships.length>=this.limits.maxRelationships||counts(request.from)>=this.limits.maxContacts||counts(request.to)>=this.limits.maxContacts)failure(429,'LIMIT','好友数量已达上限');const [a,b]=[request.from,request.to].sort();next.relationships.push({a,b});next.requests=next.requests.filter(r=>pair(r.from,r.to)!==pair(a,b));}else next.requests=next.requests.filter(r=>r.id!==request.id);
   this.commit(next);return {ok:true};
  }
  if(action==='block'){
   exact(input,['friendId']);const target=input.friendId;if(!ID.test(target)||target===self.id||!this.ids.has(target))failure(404,'NOT_FOUND','没有找到这位联系人');const exists=this.graph.blocks.some(b=>b.from===self.id&&b.to===target);if(!exists&&this.graph.blocks.length>=this.limits.maxBlocks)failure(429,'LIMIT','服务器屏蔽记录容量已满');const next=clone(this.graph);if(!exists)next.blocks.push({from:self.id,to:target});next.relationships=next.relationships.filter(e=>pair(e.a,e.b)!==pair(self.id,target));next.requests=next.requests.filter(r=>pair(r.from,r.to)!==pair(self.id,target));if(!exists||next.relationships.length!==this.graph.relationships.length||next.requests.length!==this.graph.requests.length)this.commit(next);this.removeCalls(self.id,target);return {ok:true};
  }
  if(action==='call'){
   exact(input,['friendId']);const target=input.friendId;if(!ID.test(target)||!this.ids.has(target)||!this.edge(self.id,target)||this.blocked(self.id,target))failure(403,'FORBIDDEN','请先成为互相确认的好友');if(!this.online(target))failure(409,'OFFLINE','朋友暂时不在线，请稍后再试');if([...this.calls.values()].some(c=>[c.from,c.to].some(id=>id===self.id||id===target)))failure(409,'BUSY','你或朋友已有正在进行的连接邀请');if(this.calls.size>=this.limits.maxCalls)failure(429,'LIMIT','服务器连接邀请暂时已满');const id=hex();this.calls.set(id,{id,from:self.id,to:target,ip:roomIP||address,status:'ringing',expiresAt:this.now()+120000,session:null});return {callId:id};
  }
  if(['respond-call','session','end-call'].includes(action)){
   exact(input,action==='respond-call'?['callId','accept']:['callId']);if(!ID.test(input.callId)||action==='respond-call'&&typeof input.accept!=='boolean')failure(400,'BAD_SCHEMA','连接邀请格式不完整');const call=this.calls.get(input.callId);if(!call||call.from!==self.id&&call.to!==self.id)failure(404,'NOT_FOUND','连接邀请不存在或已过期');
   if(action==='end-call'){if(call.session)this.destroyRoom(call.session.host.roomId);this.calls.delete(call.id);return {ok:true};}
   if(action==='respond-call'){if(call.to!==self.id)failure(403,'FORBIDDEN','只能处理朋友发来的连接邀请');if(!input.accept){if(call.session)this.destroyRoom(call.session.host.roomId);this.calls.delete(call.id);return {ok:true};}if(call.status==='accepted')return {ok:true};if(!this.edge(call.from,call.to)||this.blocked(call.from,call.to))failure(403,'FORBIDDEN','这段好友关系已不可用');call.session=this.createPairedRoom({ip:call.ip,expiresAt:call.expiresAt});call.status='accepted';return {ok:true};}
   if(call.status!=='accepted'||!call.session)failure(409,'CONFLICT','朋友还没有接受这次连接');const host=call.from===self.id;return {serverUrl:call.session.serverUrl,host,room:clone(host?call.session.host:call.session.guest),peer:this.public(host?call.to:call.from)};
  }
  failure(404,'NOT_FOUND','没有这个好友操作');
 }
 close(){for(const c of this.calls.values())if(c.session)this.destroyRoom(c.session.host.roomId);this.calls.clear();this.presence.clear();this.rates.clear();}
}
module.exports={FriendsStore,CODE,ALPHABET};
