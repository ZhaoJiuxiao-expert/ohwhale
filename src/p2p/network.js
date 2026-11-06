import {PeerLink} from './peer.js';
const MAX_RESPONSE=230000;
function serverURL(value){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('信令地址须为HTTPS域名，或测试用本机HTTP地址');return url.origin;}
function plain(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('邀请码格式无效');return value;}
function decode(code){if(typeof code!=='string'||code.length>2000||!/^OH1\.[A-Za-z0-9_-]+$/.test(code))throw Error('邀请码格式无效');let data;try{const raw=code.slice(4).replace(/-/g,'+').replace(/_/g,'/');data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(raw),c=>c.charCodeAt(0))));}catch{throw Error('邀请码无法读取');}plain(data,['v','u','r','k','e']);if(data.v!==1||!/^[a-f0-9]{32}$/.test(data.r)||!/^[A-Za-z0-9_-]{32,128}$/.test(data.k)||!Number.isSafeInteger(data.e)||data.e<=Date.now()||data.e>Date.now()+660000)throw Error('邀请码已失效或格式无效');data.u=serverURL(data.u);return data;}
export function inspectPublicInvite(code){const value=decode(code);return {serverUrl:value.u,expiresAt:value.e};}
function person(name){if(typeof name!=='string'||!name.length||name.length>100||/[\x00-\x1f\x7f/\\:]/.test(name)||name.includes('..'))throw Error('显示名称格式无效');return name;}
export class PublicPeerSession{
 constructor({serverUrl='',ownerToken='',iceTransportPolicy='all',onState=()=>{},onMessage=()=>{},onError=()=>{},fetch:fetcher=globalThis.fetch}={}){
  this.serverUrl=serverUrl?serverURL(serverUrl):'';if(!['all','relay'].includes(iceTransportPolicy))throw Error('ICE策略无效');this.ownerToken=ownerToken;this.policy=iceTransportPolicy;this.onState=onState;this.onMessage=onMessage;this.onError=onError;this.fetch=(...args)=>fetcher.call(globalThis,...args);
  this._closed=false;this._started=false;this._controllers=new Set();this._room=null;this._link=null;this._signaling='idle';this._status='new';this._local=null;this._offerSent=false;this._answerAccepted=false;this._timer=null;this._pollStopped=false;
 }
 get info(){return {...(this._link?.info||{sessionId:this._room?.roomId||'',remoteName:'',mode:this._local?.mode||this._room?.mode||'human',connected:false}),serverUrl:this.serverUrl,signalingStatus:this._signaling,expiresAt:this._room?.expiresAt,credentialExpiresAt:this._room?.credentialExpiresAt,iceTransportPolicy:this.policy};}
 _state(status=this._status){this._status=status;try{this.onState({status,info:this.info});}catch{}}
 _error(error){try{this.onError(error instanceof Error?error:new Error(String(error)));}catch{}}
 async _request(path,{method='GET',token=this._room?.token,body}={}){
  if(this._closed)throw Error('连接已经关闭');const controller=new AbortController();this._controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await this.fetch(this.serverUrl+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
   let raw='';if(response.body?.getReader){const reader=response.body.getReader(),parts=[];let size=0;try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>MAX_RESPONSE)throw Error('信令服务器响应过大');parts.push(next.value);}}finally{try{await reader.cancel();}catch{}}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}else{raw=await response.text();if(raw.length>MAX_RESPONSE)throw Error('信令服务器响应过大');}
   let value;try{value=JSON.parse(raw);}catch{throw Error('信令服务器返回无效JSON');}if(!response.ok){const error=new Error(value?.error?.message||'信令请求失败');error.code=value?.error?.code||'SIGNAL_HTTP';throw error;}return value;
  }catch(error){if(controller.signal.aborted){const e=new Error(this._closed?'连接已关闭':'信令请求超时');e.code='SIGNAL_TIMEOUT';throw e;}throw error;}finally{clearTimeout(timeout);this._controllers.delete(controller);}
 }
 _roomData(value){plain(value,['roomId','token','code','expiresAt','credentialExpiresAt','iceServers','mode','policy']);if(!/^[a-f0-9]{32}$/.test(value.roomId)||!/^[A-Za-z0-9_-]{32,128}$/.test(value.token)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||!['human','agent'].includes(value.mode)||!['all','relay'].includes(value.policy)||!Array.isArray(value.iceServers))throw Error('服务器房间信息无效');this._room=value;if(value.policy==='relay')this.policy='relay';if(this.policy==='relay'&&!value.iceServers.some(item=>(Array.isArray(item.urls)?item.urls:[item.urls]).some(url=>/^turns?:/.test(url))))throw Error('强制中继需要有效TURN配置');}
 _startLink(){if(this._link)return this._link;return this._link=new PeerLink({iceServers:this._room.iceServers,iceTransportPolicy:this.policy,onMessage:message=>{try{this.onMessage(message);}catch{}},onError:error=>this._error(error),onState:event=>{
   if(this._closed)return;if(event.status==='connected'){this._pollStopped=true;clearTimeout(this._timer);this._signaling='complete';this._request('/v1/rooms/'+this._room.roomId+'/ready',{method:'POST'}).catch(()=>{});}
   if(['disconnected','closed'].includes(event.status)){this._pollStopped=true;this._signaling='closed';clearTimeout(this._timer);}
   this._state(event.status);
  }});}
 async startGranted(grant,{name}={}){
  if(this._started||this._closed)throw Error('请重新发起一段好友聊天。');person(name);
  if(!grant||typeof grant.host!=='boolean'||!grant.peer||!/^[a-f0-9]{32}$/.test(grant.peer.id))throw Error('好友连接凭据无效。');
  const origin=serverURL(grant.serverUrl);if(!this.serverUrl||origin!==this.serverUrl)throw Error('好友服务地址不匹配。');
  if(grant.room?.mode!=='human')throw Error('好友邀请不能自动开放 AI 分享。');
  this._roomData(grant.room);this._started=true;this._host=grant.host;this._local={name,mode:'human'};this._signaling=this._host?'waiting-peer':'waiting-offer';this._state('connecting');this._loop();
  return {serverUrl:this.serverUrl,expiresAt:this._room.expiresAt};
 }
 async create({name,mode='human',agentName}={}){
  if(this._started||this._closed)throw Error('请新建连接后再生成邀请');person(name);if(!['human','agent'].includes(mode))throw Error('会话模式无效');if(agentName!==undefined)person(agentName);if(!this.serverUrl)throw Error('请先填写自己的信令服务器地址');if(typeof this.ownerToken!=='string'||this.ownerToken.length<32)throw Error('请提供此服务器的房间创建令牌');
  this._started=true;this._host=true;this._local={name,mode,agentName};this._signaling='creating';this._state('connecting');
  try{const value=await this._request('/v1/rooms',{method:'POST',token:this.ownerToken,body:{mode,policy:this.policy}});this._roomData(value);decode(value.code);this._signaling='waiting-peer';this._state();this._loop();return {code:value.code,expiresAt:value.expiresAt,serverUrl:this.serverUrl};}catch(error){this._fail(error);throw error;}
 }
 async join(code,{name}={}){
  if(this._started||this._closed)throw Error('请新建连接后再接受邀请');person(name);const value=decode(code);if(this.serverUrl&&this.serverUrl!==value.u)throw Error('邀请码指向其他信令服务器，请核对地址后重新连接');this.serverUrl=value.u;this._started=true;this._host=false;this._local={name};this._signaling='joining';this._state('connecting');
  try{this._roomData(await this._request('/v1/rooms/'+value.r+'/join',{method:'POST',token:'',body:{secret:value.k}}));this._signaling='waiting-offer';this._state();this._loop();return {serverUrl:this.serverUrl,expiresAt:this._room.expiresAt};}catch(error){this._fail(error);throw error;}
 }
 async _tick(){
  if(this._closed||this._pollStopped)return;if(Date.now()>=this._room.expiresAt){const error=new Error('邀请码或配对等待已过期，请重新生成');error.code='INVITE_EXPIRED';throw error;}
  const value=await this._request('/v1/rooms/'+this._room.roomId+'/signal');
  if(this._host&&value.state==='paired'&&!this._offerSent){this._offerSent=true;this._signaling='gathering';this._state();const code=await this._startLink().createOffer(this._local);await this._request('/v1/rooms/'+this._room.roomId+'/signal',{method:'POST',body:{type:'offer',code}});this._signaling='waiting-answer';this._state();}
  if(value.signal){plain(value.signal,['type','code']);if(this._host&&value.signal.type==='answer'&&!this._answerAccepted){this._answerAccepted=true;await this._link.acceptAnswer(value.signal.code);this._signaling='connecting-rtc';this._state();}else if(!this._host&&value.signal.type==='offer'&&!this._answerAccepted){this._answerAccepted=true;this._signaling='gathering';this._state();const code=await this._startLink().acceptOffer(value.signal.code,{name:this._local.name});await this._request('/v1/rooms/'+this._room.roomId+'/signal',{method:'POST',body:{type:'answer',code}});this._signaling='connecting-rtc';this._state();}}
 }
 _loop(){this._tick().then(()=>{if(!this._closed&&!this._pollStopped)this._timer=setTimeout(()=>this._loop(),750);}).catch(error=>{if(!this._closed&&!this._link?.info.connected)this._fail(error);});}
 _fail(error){this._error(error);this.close();this._signaling='failed';this._state('disconnected');}
 send(message){if(!this._link)return Promise.reject(new Error('数据通道尚未连接'));return this._link.send(message);}
 diagnostics(){return this._link?this._link.diagnostics():Promise.resolve({connected:false,signalingStatus:this._signaling});}
 close(){if(this._closed)return;clearTimeout(this._timer);this._pollStopped=true;for(const controller of this._controllers)controller.abort();this._controllers.clear();this._link?.close();if(this._room){this.fetch(this.serverUrl+'/v1/rooms/'+this._room.roomId,{method:'DELETE',headers:{Authorization:'Bearer '+this._room.token},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(3000)}).catch(()=>{});}this._closed=true;this.ownerToken='';this._signaling='closed';this._state('closed');}
}
