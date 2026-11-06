'use strict';
require('./globals.cjs');
const native=require('./native.cjs');
const fs=require('./fs.cjs');
const path=require('./path.cjs');
const crypto=require('./crypto.cjs');
const {nativeFetch}=require('./fetch.cjs');
const {friendsFetch,managedFetch}=require('./friends-fetch.cjs');
const {ManagedClient}=require('../core/managed-client.cjs');
const {FriendsClient,FRIENDS_METHODS}=require('../core/friends-client.cjs');
const {ChatStore,validateAttachments}=require('../core/store.cjs');
const {Harness}=require('../core/harness.cjs');
const {speechText,VoiceSession}=require('../core/voice-session.cjs');
const {PluginStore}=require('../core/plugins.cjs');
const {StudioStore}=require('../core/studio.cjs');
const {KnowledgeStore}=require('../core/knowledge.cjs');
const {StudioService}=require('../core/studio-service.cjs');
const {exportRoleCard,importRoleCard,MAX_CARD_BYTES}=require('../core/role-card.cjs');
const knowledgeSources=require('../data/knowledge.json');
const skills=require('../data/studio-skills.json');
const defaults=require('../data/agents.json');
const APP_VERSION=require('./version.json').version;
const clone=value=>JSON.parse(JSON.stringify(value));
function text(value,max=8000){if(typeof value!=='string'||value.length>max||value.includes('\0'))throw Error('这段文字的格式或长度不符合要求，请调整后重试。');return value;}
function installMobileBridge({host,fetcher=nativeFetch}={}){
 if(host)native.setHost(host);
 const dir='/userdata';fs.mkdirSync(dir,{recursive:true});
 const listeners=new Set();const emit=event=>{for(const listener of listeners)try{listener(event);}catch{}};const changed=()=>emit({type:'state'});
 let encryptEndpoint='';
 const store=new ChatStore({dir:path.join(dir,'chat'),encrypt:value=>native.sync('secretPut',{value,endpoint:encryptEndpoint}),decrypt:token=>'@android-key:'+token});
 const friends=new FriendsClient({dir:path.join(dir,'friends'),fetch:friendsFetch,encrypt:(value,serverUrl)=>native.sync('friendsSecretPut',{value,endpoint:serverUrl}),decrypt:token=>'@android-friend:'+token});
 const managed=new ManagedClient({store,friends,fetch:managedFetch});
 const media={
  validated(items=[]){return validateAttachments(items).map(item=>{const saved=native.sync('mediaMeta',{id:item.id});for(const key of ['type','mime','name','url','bytes'])if(saved[key]!==item[key])throw Error('这份附件和本机原件不一致，请重新添加。');return saved;});},
  resolve(id){return native.sync('mediaRead',{id});},
  fromData(input){return native.sync('mediaData',input);},
  get(id){const meta=native.sync('mediaMeta',{id});const asset=native.sync('mediaRead',{id});return {meta,buffer:Buffer.from(asset.dataUrl.split(',')[1],'base64')};}
 };
 const agentById=id=>{const agent=store.getPublic().agents.find(a=>a.id===id);if(!agent)throw Error('这位角色暂时没找到，请重新选择。');return agent;};
 const plugins=new PluginStore({dir:path.join(dir,'plugins'),validateAgent:agentById,validateAttachments:a=>media.validated(a)});
 const harness=new Harness({store,managedRequest:input=>managed.request(input),fetch:fetcher,resolveImage:a=>media.resolve(a.id),onEvent:emit,contextForAgent:id=>{const state=plugins.getPublic();return [state.settings.stickers?'可以偶尔用一个表情标记：[sticker:rice]开饭、[sticker:hello]招呼、[sticker:hug]安慰、[sticker:think]思考、[sticker:cheer]加油、[sticker:sleep]晚安；不必每条都使用。':'',plugins.contextForAgent(id)].filter(Boolean).join('\n').slice(0,4000);},log:event=>fs.appendFileSync(path.join(dir,'api-usage.jsonl'),JSON.stringify(event)+'\n')});
 const studio=new StudioStore({dir,validateAttachment:a=>{const saved=media.validated([a])[0];if(saved.type!=='image')throw Error('请为内容选择一张图片。');return saved;}});
 const sharedSources=new Set(['src/core/store.cjs','src/core/harness.cjs','src/core/plugins.cjs','src/core/studio.cjs','src/core/knowledge.cjs','src/core/studio-service.cjs','src/core/role-card.cjs']);
 const mobileSources=knowledgeSources.filter(s=>sharedSources.has(s.source)||/^https:\/\//.test(s.source));
 mobileSources.push({id:'android-privacy',title:'Android 本机安全与能力边界',source:'android/src/cn/ohwhale/chat/MainActivity.java',evidence:'code-verified',verify:['AndroidKeyStore','AES/GCM/NoPadding','OhWhaleNative'],text:'Android 使用 Keystore AES-GCM 保护本机聊天、记忆、项目快照、原件与媒体。网页只加载内置可信资源；模型HTTP由原生层执行，密钥通过绑定接口地址的opaque handle引用，不返回bootstrap。角色名与模型分开，工作台使用中性system，P2P共享不带主人私聊或记忆。录音先生成真实WAV，可手工补文字；系统语音输入依设备能力而定，不假装转写。系统TTS生成真实音频后由界面播放。Android版不启动本机HTTP共享服务器。'});
 const knowledge=new KnowledgeStore({dir:path.join(dir,'knowledge'),defaultSources:mobileSources,skills});
 const service=new StudioService({dir,studio,knowledge,store,media,harness,onChange:changed});
 const voiceSession=new VoiceSession();let capabilities={},closeHandler=async()=>{};const shares=new Map();let greetingBusy=false;
 const revoke=()=>{for(const session of shares.values())session.controller?.abort();shares.clear();};
 function validateSharedAgent(id){const a=agentById(id),p=store.getProvider(a.providerId);if(!p?.consent)throw Error('请先为这位角色配置并授权模型服务。');if(!p.managed&&!p.apiKey&&!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(p.baseUrl))throw Error('请先保存这位角色所用的API密钥。');return a;}
 async function saveJson(name,value){return native.rpc('exportJson',{name,text:JSON.stringify(value,null,2)});}
 const methods={
  async bootstrap(){capabilities=await native.rpc('capabilities');return {state:store.getPublic(),plugins:plugins.getPublic(),runtime:{version:APP_VERSION,platform:'android',capabilities,dataDirectory:'Android 应用私有加密资料',customStickers:service.customStickers(),speechAvailable:false,voices:[]}};},
  managedCatalog:()=>managed.catalog(),managedUsage:()=>managed.usage(),async managedConnect(input){const result=await managed.connect(input);revoke();changed();return result;},
  saveProvider(input){const old=store.getPublic().providers.find(p=>p.id===input?.id);encryptEndpoint=input?.baseUrl??old?.baseUrl??'';try{encryptEndpoint=new URL(encryptEndpoint).href.replace(/\/+$/,'');}catch{}const result=store.saveProvider(input);revoke();changed();return result;},
  send:async input=>{const result=await harness.send({...input,attachments:media.validated(input?.attachments??[])});const c=store.getConversation(input.conversationId);if(c?.agentId)plugins.recordActivity({agentId:c.agentId});changed();return result;},
  cancel:input=>harness.cancel(input?.conversationId),
  importMedia:()=>native.rpc('pickImage'),pasteImage:()=>native.rpc('pasteImage'),peerMedia:input=>media.fromData(input),readMedia:input=>media.resolve(input?.id),
  transcribe(){throw Error('Android 版暂不转写已录制的WAV。可以用系统语音输入，或保存原声后手工补上文字。');},
  saveRecording:input=>{if(!plugins.getPublic().settings.voice)throw Error('先打开语音小开关，再留下这段声音吧。');return native.rpc('saveRecording',input);},
  nativeRecognize:()=>native.rpc('nativeRecognize'),stopSpeech:input=>{const prefix=input?.conversationId?input.conversationId+':'+(input.messageId||''):undefined;const stopped=voiceSession.stop(prefix);return stopped||!prefix?native.rpc('stopSpeech'):false;},
  speak(input){
   if(!plugins.getPublic().settings.voice)throw Error('先打开语音小开关，就能听见我啦。');const c=store.getConversation(input?.conversationId);if(!c)throw Error('请先打开一段对话。');const m=store.getMessages(c.id).find(x=>x.id===input?.messageId);if(!m)throw Error('这条消息没找到。');const readable=speechText(m.text);if(!readable)throw Error('这条消息只有表情或图片，还没有可念出的文字呀。');const existing=m.attachments?.find(a=>a.type==='audio');if(existing){voiceSession.stop();return native.rpc('stopSpeech').then(()=>({attachment:existing}));}const a=c.agentId?agentById(c.agentId):null;
   return voiceSession.run(c.id+':'+m.id,async signal=>{const speechId=crypto.randomUUID();const stop=()=>native.rpc('stopSpeech',{speechId}).catch(()=>{});signal.addEventListener('abort',stop,{once:true});try{if(signal.aborted)throw Error('这句先不念啦。');const result=await native.rpc('speak',{speechId,text:readable.slice(0,3500),name:(a?.name||'小伙伴')+'的声音.wav',voice:a?.voice||''});if(signal.aborted)throw Error('这句先不念啦。');const now=store.getMessages(c.id).find(x=>x.id===m.id);store.patchMessage(c.id,m.id,{attachments:[...(now.attachments||[]),result.attachment]});changed();return result;}finally{signal.removeEventListener('abort',stop);}});
  },
  copyText:input=>native.rpc('copyText',{text:text(input?.text,200000)}),
  exportAgent:input=>saveJson('哦鲸鲸角色-'+Date.now()+'.json',exportRoleCard({store,media,agentId:input?.agentId})),
  async importAgent(){const file=await native.rpc('pickJson');if(!file)return null;if(file.text.length>MAX_CARD_BYTES)throw Error('角色卡超过16MB，请选择较小卡片。');const input=JSON.parse(file.text);const folder=path.join(dir,'role-card-imports');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,Date.now()+'-'+crypto.randomUUID()+'.json'),file.text,{flag:'wx'});const result=importRoleCard({store,media,input});changed();return result;},
  exportHistory(){const s=store.getPublic();return saveJson('哦鲸鲸聊天-'+Date.now()+'.json',{app:'哦鲸鲸',version:APP_VERSION,exportedAt:new Date().toISOString(),conversations:s.conversations,messages:s.messages});},
  recordPeer(input){const name=text(input?.name||'远方朋友',80),peerId=text(input?.peerId,128);let c=input?.conversationId?store.getConversation(input.conversationId):null;if(c&&(c.type!=='peer'||c.peerId!==peerId))throw Error('这段连接与会话不匹配，请重新建立连接。');if(!c)c=store.createConversation({type:'peer',name,peerId});const m=input?.message;if(!m||typeof m.id!=='string')throw Error('对端消息没有完整读到。');const old=store.getMessages(c.id).find(x=>x.id===m.id);if(old)return {conversationId:c.id,message:old};const ai=m.source==='ai'&&m.role==='assistant';const message=store.addMessage(c.id,{id:m.id,role:ai?'assistant':'peer',source:ai?'ai':'peer',text:text(m.text||''),attachments:media.validated(m.attachments??[]),status:'sent',...(ai?{model:'对端提供 · '+text(m.model||'未知模型',150)}:{})});changed();return {conversationId:c.id,message};},
  recordPeerOutgoing(input){const c=store.getConversation(input?.conversationId);if(!c||c.type!=='peer')throw Error('请先打开点对点会话。');const id=text(input?.clientId,100),old=store.getMessages(c.id).find(x=>x.id===id);if(old&&old.role!=='user')throw Error('这条消息的标识已被占用。');const patch={text:text(input.text||''),attachments:media.validated(input.attachments??[]),status:['pending','sent','failed'].includes(input.status)?input.status:'sent'};const result=old?store.patchMessage(c.id,id,patch):store.addMessage(c.id,{id,...patch,role:'user',source:'user'});changed();return result;},
  setPeerShare(input){const sessionId=text(input?.sessionId,100);if(!/^[A-Za-z0-9_-]+$/.test(sessionId))throw Error('连接标识无效。');if(input.enabled!==true){shares.get(sessionId)?.controller?.abort();shares.delete(sessionId);return {enabled:false,remaining:0};}validateSharedAgent(input.agentId);const limit=input.limit??20;if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('每次分享最多20条请求。');shares.get(sessionId)?.controller?.abort();shares.set(sessionId,{agentId:input.agentId,remaining:limit,requests:[],seen:new Set(),history:[],controller:null});return {enabled:true,remaining:limit};},
  async aiForPeer(input){const s=shares.get(input?.sessionId);if(!s)throw Error('本次分享已关闭，请重新征得主人同意。');if(s.controller)throw Error('这段分享正在回复，请稍等。');if(s.remaining<=0)throw Error('本次分享额度已经用完。');const id=text(input.requestId,100);if(s.seen.has(id))throw Error('这条请求已经接收过，不会重复使用模型额度。');const now=Date.now();s.requests=s.requests.filter(t=>now-t<60000);if(s.requests.length>=6)throw Error('这段连接请求有些密集，请稍后再聊。');text(input.text,8000);const attachments=media.validated(input.attachments??[]);validateSharedAgent(s.agentId);const controller=new AbortController();s.controller=controller;s.seen.add(id);s.requests.push(now);s.remaining--;try{const reply=await harness.replyExternal({agentId:s.agentId,text:input.text,attachments,signal:controller.signal,history:s.history.slice(-12)});if(shares.get(input.sessionId)!==s||controller.signal.aborted)throw Error('本次分享已停止，回复不会继续送出。');s.history.push({role:'user',content:input.text},{role:'assistant',content:reply.text});s.history=s.history.slice(-12);return reply;}finally{if(s.controller===controller)s.controller=null;}},
  shareStart(){throw Error('Android 版暂不启动本机 HTTP API 服务器；你仍可使用点对点聊天。');},shareStop(){revoke();return {running:false};},shareStatus:()=>({running:false,unsupported:true}),
  pluginConfigure(input){const r=plugins.configure(input);changed();return r;},remember(input){const r=plugins.remember(input);changed();return r;},forgetMemory(input){const r=plugins.forgetMemory(input);changed();return r;},
  addDiary(input){const result=plugins.addDiary({agentId:input?.agentId,text:text(input?.text||'',4000),source:'user'});changed();return result;},
  spacePost(input){const r=plugins.addPost({authorId:'me',source:'user',text:text(input?.text||'',4000),attachments:media.validated(input?.attachments??[])});changed();return r;},spaceLike(input){const r=plugins.toggleLike(input);changed();return r;},spaceComment(input){const r=plugins.addComment({postId:input?.postId,authorId:'me',source:'user',text:text(input?.text||'',1000)});changed();return r;},
  async generateDiary(input){if(!plugins.getPublic().settings.diary)throw Error('请先打开日常记录。');const a=agentById(input?.agentId),c=store.getConversation(input?.conversationId);if(!c||c.agentId!==a.id)throw Error('请先打开这位角色的对话。');const day=new Date().toLocaleDateString('sv-SE'),entries=store.getMessages(c.id).filter(m=>m.status==='sent'&&new Date(m.createdAt).toLocaleDateString('sv-SE')===day).slice(-12);if(!entries.length)throw Error('今天还没有可记录的对话，先聊几句吧。');const reply=await harness.replyExternal({agentId:a.id,text:'请把以下今天的对话整理成100至200字角色日记，只记录实际讨论的内容，区分虚构想象与真实发生，不补造隐私。\n'+entries.map(m=>(m.role==='user'?'我':'你')+'：'+m.text).join('\n').slice(-6500)});const d=plugins.addDiary({agentId:a.id,source:'ai',text:reply.text.slice(0,4000),day});changed();return d;},
  async spaceGenerate(input){if(!plugins.getPublic().settings.space)throw Error('请先打开本机空间。');const a=agentById(input?.agentId),prompt=text(input?.prompt||'',2000),post=input?.postId?plugins.getPublic().posts.find(p=>p.id===input.postId):null;if(input?.postId&&!post)throw Error('这条动态没找到。');const reply=await harness.replyExternal({agentId:a.id,text:post?'以你的角色语气回复以下本机动态，60字以内，不声称做过现实动作。动态：'+post.text.slice(0,3500)+'\n补充：'+prompt:'为你自己的虚构角色写一条100字以内日常动态，不冒称现实行动，不引用主人的私聊。主题：'+(prompt||'今天的小心情')});const result=post?plugins.addComment({postId:post.id,authorId:a.id,text:reply.text.slice(0,1000),source:'ai'}):plugins.addPost({authorId:a.id,text:reply.text.slice(0,4000),source:'ai',attachments:[]});changed();return result;},
  studioList:()=>studio.listProjects(),studioOpen:input=>studio.getProject(input?.projectId),studioValidate:input=>studio.validateEntry(input?.entry),studioHistory:input=>studio.history(input?.projectId),
  studioSkills:()=>service.skills(),knowledgeSearch:input=>knowledge.search({query:input?.query,limit:8}),knowledgeRebuild:()=>knowledge.rebuild(),knowledgeStatus:()=>knowledge.status(),studioNovels:()=>knowledge.listNovels(),
  studioExport:input=>saveJson('哦鲸鲸内容包-'+Date.now()+'.json',service.exportBundle(input?.projectId)),
  async studioImport(){const file=await native.rpc('pickJson');if(!file)return null;const p=service.importBundle(JSON.parse(file.text));changed();return p;},
  async studioImportNovel(){const file=await native.rpc('pickNovel');if(!file)return null;const result=knowledge.importText({title:file.name,text:file.text,source:file.source});return {...result,originalArchive:file.originalArchive};},
  onEvent(listener){listeners.add(listener);return()=>listeners.delete(listener);},setCloseHandler(callback){if(typeof callback==='function')closeHandler=callback;}
 };
 for(const method of ['saveAgent','createConversation','setConversation','updateSettings','saveDraft'])methods[method]=input=>{const result=store[method](input);changed();return result;};
 for(const [method,member]of Object.entries(FRIENDS_METHODS))methods[method]=input=>friends[member](input);
 for(const [name,method]of Object.entries({studioCreate:'createProject',studioRename:'renameProject',studioSaveEntry:'saveEntry',studioCopyEntry:'copyEntry',studioRollback:'rollback',studioApply:'applyProposal'}))methods[name]=input=>studio[method](input);
 for(const [name,method]of Object.entries({studioSeed:'seed',studioActivate:'activate',studioAsk:'ask',studioNovelPersona:'novelPersona',studioDraftSave:'draftSave',studioDraftList:'draftList',studioDraftRemove:'draftRemove'}))methods[name]=input=>service[method](input);
 const bridge={};for(const [name,fn]of Object.entries(methods))bridge[name]=['onEvent','setCloseHandler'].includes(name)?fn:(input)=>Promise.resolve().then(()=>fn(input));
 globalThis.ly=bridge;globalThis.__ohwhaleClose=async()=>{try{await closeHandler();revoke();for(const c of store.getPublic().conversations)harness.cancel(c.id);await native.rpc('finish');}catch(e){emit({type:'error',text:e.message});}};
 const timer=setInterval(async()=>{if(greetingBusy||globalThis.document?.visibilityState==='hidden'||!plugins.getPublic().settings.proactive)return;const now=new Date(),hour=now.getHours(),day=now.toLocaleDateString('sv-SE'),s=store.getPublic(),q=s.settings.quietHours;if(q?.enabled&&(q.start<q.end?hour>=q.start&&hour<q.end:hour>=q.start||hour<q.end))return;greetingBusy=true;try{for(const agent of s.agents){if(!agent.greeting.enabled||agent.greeting.hour!==hour||s.greetings[agent.id]===day||!agent.providerId)continue;const c=s.conversations.find(c=>c.agentId===agent.id&&c.type==='ai'&&!c.archived);if(!c)continue;store.markGreeting(agent.id,day);try{await harness.send({conversationId:c.id,greeting:true});}catch{}}}finally{greetingBusy=false;}},60000);
 return {bridge,store,studio,plugins,knowledge,service,harness,media,dispose(){clearInterval(timer);voiceSession.stop();revoke();for(const c of store.getPublic().conversations)harness.cancel(c.id);}};
}
module.exports={installMobileBridge};
