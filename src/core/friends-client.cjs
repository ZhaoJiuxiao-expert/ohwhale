'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const defaults=require('../data/network-defaults.json');
const MAX_RESPONSE=512*1024;
const GROUP_ROUTES=new Set(['overview','create','get','send','invite','respond-invite','create-invite','revoke-invite','join','manage','add-agent','tasks','claim','complete','fail','asset']);
const METHODS={friendsStatus:'status',friendsEnable:'enable',friendsState:'state',friendsRequest:'request',friendsRespond:'respond',friendsBlock:'block',friendsCall:'call',friendsRespondCall:'respondCall',friendsSession:'session',friendsEndCall:'endCall'};
const copy=value=>JSON.parse(JSON.stringify(value));
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('这份好友资料的格式不完整，请重新试试。');return value;}
function id(value){if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value))throw Error('这位伙伴的标识不完整，请重新选择。');return value;}
function code(value){if(typeof value!=='string'||!/^JW-(?:[A-HJ-NP-Z2-9]{4}-){2}[A-HJ-NP-Z2-9]{4}$/.test(value))throw Error('鲸鲸号应是 JW 开头的三组字符，请核对一下呀。');return value;}
function name(value){if(typeof value!=='string'||!value.trim()||value.length>60||/[\x00-\x1f\x7f/\\:]/.test(value)||value.includes('..'))throw Error('给自己取个 1 到 60 字、不含斜杠或冒号的小昵称吧。');return value.trim();}
function bool(value){if(typeof value!=='boolean')throw Error('请明确选择接受或婉拒呀。');return value;}
function timestamp(value){if(!Number.isSafeInteger(value)||value<0)throw Error('好友服务返回的时间不完整，请稍后重试。');return value;}
function serverURL(value){let u;try{u=new URL(value);}catch{throw Error('好友服务地址不完整。');}if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('好友服务只支持 HTTPS 或本机测试地址。');return u.origin;}
function person(value){object(value,['id','code','name']);return {id:id(value.id),code:code(value.code),name:name(value.name)};}
function list(value,fn,max=500){if(!Array.isArray(value)||value.length>max)throw Error('好友列表有些异常，请稍后重试。');return value.map(fn);}
function publicState(value,expected){
 object(value,['self','contacts','requests','calls']);const self=person(value.self);if(self.id!==expected.id||self.code!==expected.code)throw Error('好友资料与本机身份不一致，连接已停止。');
 const contacts=list(value.contacts,c=>{object(c,['id','code','name','online']);return {...person({id:c.id,code:c.code,name:c.name}),online:bool(c.online)};});
 object(value.requests,['incoming','outgoing']);const requests={};for(const [direction,key]of [['incoming','from'],['outgoing','to']])requests[direction]=list(value.requests[direction],r=>{object(r,['id',key,'createdAt']);return {id:id(r.id),[key]:person(r[key]),createdAt:timestamp(r.createdAt)};});
 const calls=list(value.calls,c=>{object(c,['id','peer','direction','status','expiresAt']);if(!['incoming','outgoing'].includes(c.direction)||!['ringing','accepted'].includes(c.status))throw Error('聊天邀请的状态不完整。');return {id:id(c.id),peer:person(c.peer),direction:c.direction,status:c.status,expiresAt:timestamp(c.expiresAt)};},20);
 return {self,contacts,requests,calls};
}
function sessionGrant(value,origin){
 object(value,['serverUrl','host','room','peer']);if(serverURL(value.serverUrl)!==origin)throw Error('这份聊天邀请指向了其他服务，已停止连接。');bool(value.host);person(value.peer);
 const r=value.room;object(r,['roomId','token','expiresAt','credentialExpiresAt','iceServers','mode','policy']);id(r.roomId);if(typeof r.token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(r.token)||r.mode!=='human'||!['all','relay'].includes(r.policy)||timestamp(r.expiresAt)<=Date.now()||r.expiresAt>Date.now()+660000||timestamp(r.credentialExpiresAt)<r.expiresAt)throw Error('这份聊天邀请已过期或不完整，请重新邀请呀。');
 list(r.iceServers,s=>{object(s,['urls','username','credential']);const urls=Array.isArray(s.urls)?s.urls:[s.urls];if(!urls.length||urls.length>8||urls.some(u=>typeof u!=='string'||u.length>512||!/^(stun|stuns|turn|turns):[^\s@/#]+(?:\?transport=(udp|tcp))?$/.test(u)))throw Error('中继配置不完整，请稍后重试。');for(const k of ['username','credential'])if(s[k]!==undefined&&(typeof s[k]!=='string'||s[k].length>1024||/[\x00-\x1f\x7f]/.test(s[k])))throw Error('中继配置不完整，请稍后重试。');return s;},8);
 return copy(value);
}
const ERRORS={UNAUTHORIZED:'本机好友凭据暂时没有通过验证，请保留应用数据并联系维护者。',AUTH:'本机好友凭据暂时没有通过验证，请保留应用数据并联系维护者。',NOT_FOUND:'这位伙伴或这份邀请暂时没找到，核对鲸鲸号后再试试吧。',OFFLINE:'伙伴现在不在线，等对方打开哦鲸鲸再邀请吧。',BUSY:'有一份聊天邀请正在进行，先完成或取消它吧。',RATE_LIMIT:'操作有点快啦，稍等一会儿再试。',BLOCKED:'暂时不能向这位伙伴发送邀请。',FORBIDDEN:'这项操作还没有获得对方许可。',CONFLICT:'这份邀请状态已经变化，刷新后再看看吧。',LIMIT:'好友服务暂时达到上限，请稍后再试。'};
Object.assign(ERRORS,{GROUPS_DISABLED:'群聊小站还没有开启，请稍后再来。',MUTED:'暂时不能在这个群发言。',SLOW_MODE:'群聊正在慢速模式，请稍等再发。',STORAGE_FULL:'群聊小站存储已满，请联系维护者。',EXPIRED:'群邀请或回复任务已过期，请重新发起。',INVALID:'群聊内容格式不完整，请检查后重试。'});
ERRORS.FRIENDS_DISABLED='好友小站还在准备中，请等维护者开启后再来呀。';
Object.assign(ERRORS,{MANAGED_DISABLED:'托管聊天还没有开启，可以先使用自己的 API 呀。',USER_RATE_LIMIT:'发得有点快啦，请稍等片刻再聊。',USER_DAILY_LIMIT:'今天的托管次数已用完，明天 UTC 零点恢复；也可以切换自己的 API。',GLOBAL_DAILY_LIMIT:'小站今天的共享额度用完啦，可以切换自己的 API。',CONCURRENT_LIMIT:'上一条回复还在路上，请等它完成或先取消。',BUDGET_LIMIT:'这段聊天超过今天的可用额度，请缩短内容或切换自己的 API。',MODEL_NOT_ALLOWED:'这位模型不在托管名单里，请重新选择或使用自己的 API。',UPSTREAM_ERROR:'模型伙伴暂时没回应，请稍后手动重试。',UPSTREAM_TIMEOUT:'模型伙伴等待太久啦，请稍后手动重试。',BODY_LIMIT:'内容有点多啦，请缩小图片或缩短上下文后再试。',CONTEXT_LIMIT:'这段上下文太长啦，请新建聊天或减少图片后再试。'});
ERRORS.STORE_UNAVAILABLE='好友小站暂时没法保存资料，原有资料已保留，请稍后重试。';
class FriendsClient{
 constructor({dir,serverUrl=defaults.signalingServerUrl,fetch:fetcher=globalThis.fetch,encrypt,decrypt}={}){
  if(typeof dir!=='string'||typeof fetcher!=='function'||typeof encrypt!=='function'||typeof decrypt!=='function')throw Error('好友服务尚未配置完整。');
  this.dir=dir;this.serverUrl=serverURL(serverUrl);this.fetch=fetcher;this.encrypt=encrypt;this.decrypt=decrypt;this.identity=null;this.loadError='';this._enabling=null;
  fs.mkdirSync(dir,{recursive:true});const files=fs.readdirSync(dir).filter(n=>/^identity-\d{13}-[a-f0-9-]{36}\.json$/.test(n)).sort();if(files.length){try{const file=path.join(dir,files[files.length-1]);if(fs.statSync(file).size>20000)throw Error();const v=JSON.parse(fs.readFileSync(file,'utf8'));object(v,['version','serverUrl','self','encryptedToken','createdAt']);if(v.version!==1||serverURL(v.serverUrl)!==this.serverUrl||typeof v.encryptedToken!=='string'||!v.encryptedToken||v.encryptedToken.length>16000)throw Error();this.identity={...v,self:person(v.self),createdAt:timestamp(v.createdAt)};}catch{this.loadError='本机好友资料暂时读不到，已保留原件，请勿清除应用数据。';}}
 }
 status(){return {enabled:!!this.identity,serverUrl:this.serverUrl,...(this.identity?{self:copy(this.identity.self)}:{}),...(this.loadError?{error:this.loadError}:{})};}
 _require(){if(this.loadError)throw Error(this.loadError);if(!this.identity)throw Error('先开启好友聊天，就能认识新伙伴啦。');}
 async _request(route,{body,register=false,managed=false,groups=false,fetcher=this.fetch,signal}={}){
  if(groups&&Buffer.byteLength(JSON.stringify(body??{}),'utf8')>3*1024*1024)throw Error('群聊内容过大，请缩小附件后重试。');
  if(!register)this._require();let credential='';if(!register){try{credential=this.decrypt(this.identity.encryptedToken,this.serverUrl);if(typeof credential!=='string'||!credential||/[\x00-\x20\x7f]/.test(credential))throw Error();}catch{throw Error('本机好友凭据暂时读不到，已保留资料，请勿清除应用数据。');}}
  const controller=new AbortController(),cancel=()=>controller.abort(signal?.reason),timer=setTimeout(()=>controller.abort(),managed&&route==='chat/completions'?80000:10000),maxResponse=managed||groups?4*1024*1024:MAX_RESPONSE;if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});try{
   if(controller.signal.aborted)throw Error('cancelled');
   const response=await fetcher(this.serverUrl+(groups?'/v1/groups/':managed?'/v1/managed/':'/v1/friends/')+route,{method:!groups&&['state','models','usage'].includes(route)?'GET':'POST',headers:{Accept:'application/json',...(credential?{Authorization:'Bearer '+credential}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
   if(response.status>=300&&response.status<400)throw Error('好友服务发生跳转，连接已停止，请稍后重试。');let raw='';if(response.body?.getReader){const reader=response.body.getReader(),parts=[];let size=0;try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>maxResponse)throw Error('好友服务返回的内容过大，连接已停止。');parts.push(p.value);}}finally{try{await reader.cancel();}catch{}}const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.byteLength;}raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}else{raw=await response.text();if(Buffer.byteLength(raw,'utf8')>maxResponse)throw Error('好友服务返回的内容过大，连接已停止。');}
   if(controller.signal.aborted)throw Error('cancelled');let result;try{result=JSON.parse(raw);}catch{throw Error('好友服务暂时没有正确回应，请稍后再试。');}if(!response.ok){const key=typeof result?.error?.code==='string'?result.error.code:'';const e=Error(ERRORS[key]|| (response.status===429?ERRORS.RATE_LIMIT:response.status===401?ERRORS.UNAUTHORIZED:'这次好友操作没完成，请刷新后重试呀。'));e.code=Object.hasOwn(ERRORS,key)?key:'FRIENDS_HTTP';e.status=response.status;throw e;}return result;
  }catch(e){if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:Error('这次回复已取消。');if(controller.signal.aborted)throw Error(managed?'托管聊天暂时没回应，请稍后手动重试。':'好友服务暂时没回应，检查网络后再试试吧。');if(e?.code&&(Object.hasOwn(ERRORS,e.code)||e.code==='FRIENDS_HTTP')||e?.message?.startsWith('好友')||e?.message?.startsWith('这次'))throw e;throw Error('好友服务暂时连接不上，检查网络后再试试吧。');}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);credential='';}
 }
 enable(input){object(input,['name','consent']);if(input.consent!==true)throw Error('请先同意将昵称和好友关系交给联机服务保存。');const nickname=name(input.name);if(this.loadError)throw Error(this.loadError);if(this.identity)return Promise.resolve(this.status());if(this._enabling)return this._enabling;
  this._enabling=(async()=>{const result=await this._request('register',{register:true,body:{name:nickname}});object(result,['self','token']);const self=person(result.self);if(typeof result.token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(result.token))throw Error('好友服务没有返回完整身份，请稍后重试。');let encryptedToken;try{encryptedToken=this.encrypt(result.token,this.serverUrl);if(typeof encryptedToken!=='string'||!encryptedToken||encryptedToken===result.token||encryptedToken.length>16000)throw Error();}catch{throw Error('本机安全存储未准备好，好友身份尚未保存。');}finally{result.token='';}const saved={version:1,serverUrl:this.serverUrl,self,encryptedToken,createdAt:Date.now()};try{const fd=fs.openSync(path.join(this.dir,'identity-'+saved.createdAt+'-'+crypto.randomUUID()+'.json'),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(saved,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch{throw Error('本机好友身份没有保存完成，请检查存储空间后重试。');}this.identity=saved;return this.status();})().finally(()=>{this._enabling=null;});return this._enabling;
 }
 groupRequest(route,{body={},signal,fetch:fetcher=this.fetch}={}){if(!GROUP_ROUTES.has(route))throw Error('群聊通道不支持这项操作。');return this._request(route,{body,signal,fetcher,groups:true});}
 managedRequest(route,{body,signal,fetch:fetcher=this.fetch}={}){if(!['models','usage','chat/completions'].includes(route))throw Error('托管通道不支持这项操作。');return this._request(route,{body,signal,fetcher,managed:true,register:route==='models'});}
 async state(){this._require();return publicState(await this._request('state'),this.identity.self);}
 async _ok(route,body){const result=await this._request(route,{body});object(result,['ok']);if(result.ok!==true)throw Error('这次好友操作还没有完成，请刷新后再试。');return {ok:true};}
 request(input){object(input,['code']);return this._ok('request',{code:code(input.code)});}
 respond(input){object(input,['requestId','accept']);return this._ok('respond',{requestId:id(input.requestId),accept:bool(input.accept)});}
 block(input){object(input,['friendId']);return this._ok('block',{friendId:id(input.friendId)});}
 async call(input){object(input,['friendId']);const r=await this._request('call',{body:{friendId:id(input.friendId)}});object(r,['callId']);return {callId:id(r.callId)};}
 respondCall(input){object(input,['callId','accept']);return this._ok('respond-call',{callId:id(input.callId),accept:bool(input.accept)});}
 async session(input){object(input,['callId']);return sessionGrant(await this._request('session',{body:{callId:id(input.callId)}}),this.serverUrl);}
 endCall(input){object(input,['callId']);return this._ok('end-call',{callId:id(input.callId)});}
}
module.exports={FriendsClient,FRIENDS_METHODS:METHODS};
