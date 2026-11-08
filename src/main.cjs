const {app,BrowserWindow,ipcMain,dialog,safeStorage,net,protocol,nativeImage,clipboard,Notification}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {ChatStore}=require('./core/store.cjs');
const {FriendsClient,FRIENDS_METHODS}=require('./core/friends-client.cjs');
const {GroupsClient,GROUPS_METHODS}=require('./core/groups-client.cjs');
const {ManagedClient}=require('./core/managed-client.cjs');
const {Harness}=require('./core/harness.cjs');
const {MediaStore,validateWav}=require('./core/media.cjs');
const {runSpeech}=require('./core/speech.cjs');
const {VoiceSession,speechText}=require('./core/voice-session.cjs');
const {exportRoleCard,importRoleCard,MAX_CARD_BYTES}=require('./core/role-card.cjs');
const {ShareManager}=require('./core/sharing.cjs');
const {ProactiveService}=require('./core/proactive.cjs');
const {PluginStore}=require('./core/plugins.cjs');
const {StudioStore}=require('./core/studio.cjs');
const {KnowledgeStore}=require('./core/knowledge.cjs');
const {StudioService}=require('./core/studio-service.cjs');
const {installStudioBridge}=require('./studio-bridge.cjs');
const {configureDataLocation}=require('./core/data-location.cjs');
app.setName('OhWhale');
configureDataLocation(app);
protocol.registerSchemesAsPrivileged([{scheme:'lingyu-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
if(!app.requestSingleInstanceLock())app.exit(0);
let win,store,media,harness,sharing,plugins,studio,knowledge,studioService,friends,managed,groups,speechInfo={recognition:false,voices:[]},closing=false,closeCommitted=false,closeTimer,greetingTimer,proactive;
const generationJobs=new Set();
const voiceSession=new VoiceSession();
const uiURL=pathToFileURL(path.join(__dirname,'ui/index.html')).href;
function emit(event){if(win&&!win.isDestroyed())win.webContents.send('ly:event',event);}
function stateChanged(){emit({type:'state'});}
function bind(name,fn){ipcMain.handle(`ly:${name}`,async(event,input)=>{if(event.sender!==win?.webContents||event.senderFrame?.url!==uiURL)throw Error('来源未授权');return fn(input);});}
function agentById(id){const a=store.getPublic().agents.find(a=>a.id===id);if(!a)throw Error('角色不存在');return a;}
function validateSharedAgent(id){const a=agentById(id);const p=store.getProvider(a.providerId);if(!p?.consent)throw Error('请先为角色配置并授权模型接口');if(!p.managed&&!p.apiKey&&!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(p.baseUrl))throw Error('请先配置该角色的API密钥');return a;}
function text(value,max=8000){if(typeof value!=='string'||value.length>max)throw Error('文字格式或长度不符合要求');return value;}
async function exportJSON(title,defaultName,data){const d=await dialog.showSaveDialog(win,{title,defaultPath:defaultName,filters:[{name:'JSON',extensions:['json']}]});if(d.canceled)return {path:null};if(fs.existsSync(d.filePath))throw Error('为保留已有文件，请使用一个新文件名');fs.writeFileSync(d.filePath,JSON.stringify(data,null,2),{flag:'wx'});fs.appendFileSync(path.join(app.getPath('userData'),'exports.jsonl'),JSON.stringify({at:new Date().toISOString(),type:title,path:d.filePath})+'\n');return {path:d.filePath};}
function installBridge(){
 for(const [method,member]of Object.entries(FRIENDS_METHODS))bind(method,input=>friends[member](input));
 for(const [method,member]of Object.entries(GROUPS_METHODS))bind(method,input=>groups[member](input));
 bind('managedCatalog',()=>managed.catalog());bind('managedUsage',()=>managed.usage());bind('managedConnect',async input=>{const result=await managed.connect(input);sharing.revokeAll();await sharing.stopAPI();stateChanged();return result;});
 bind('closeReady',async input=>{if(!closing)return false;clearTimeout(closeTimer);closing=false;if(input?.ok){closeCommitted=true;sharing.revokeAll();await sharing.stopAPI();for(const c of store.getPublic().conversations)harness.cancel(c.id);setImmediate(()=>win.close());return true;}dialog.showErrorBox('草稿尚未保存','窗口保持打开，请检查存储空间后重试。');return false;});
 bind('proactiveStatus',()=>({...proactive.status(),supported:true,backgroundEnabled:false,platform:'windows',notificationsAllowed:Notification.isSupported()}));
 bind('proactiveCheck',async()=>{await proactive.tick();return {...proactive.status(),supported:true,backgroundEnabled:false,platform:'windows',notificationsAllowed:Notification.isSupported()};});
 bind('proactiveConfigure',()=>{throw Error('电脑上保持哦鲸鲸运行或最小化，就能收到问候；退出后会暂停。');});
 bind('proactiveOpenSettings',()=>({supported:false}));
 bind('bootstrap',()=>({state:store.getPublic(),plugins:plugins.getPublic(),runtime:{version:app.getVersion(),platform:'windows',capabilities:{transcribe:speechInfo.recognition,nativeRecognize:false,saveRecording:true},dataDirectory:app.getPath('userData'),customStickers:studioService.customStickers(),speechAvailable:speechInfo.recognition,voices:speechInfo.voices}}));
 for(const method of ['saveAgent','createConversation','setConversation','updateSettings','saveDraft'])bind(method,input=>{const r=store[method](input);stateChanged();return r;});
 bind('saveProvider',async input=>{const r=store.saveProvider(input);sharing.revokeAll();await sharing.stopAPI();stateChanged();return r;});
 bind('send',async input=>{if(!input||typeof input!=='object')throw Error('消息格式无效');const result=await harness.send({...input,attachments:media.validated(input.attachments)});const c=store.getConversation(input.conversationId);if(c.agentId)plugins.recordActivity({agentId:c.agentId});stateChanged();return result;});
 bind('cancel',input=>harness.cancel(input?.conversationId));
 bind('importMedia',async input=>{const d=await dialog.showOpenDialog(win,{title:input?.purpose==='avatar'?'为伙伴挑一张新头像':'发送图片',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp','gif']}]});if(d.canceled)return null;const f=d.filePaths[0];if(fs.statSync(f).size>10*1024*1024)throw Error('单张图片最多10MB');return media.put({buffer:fs.readFileSync(f),type:'image',name:path.basename(f)});});
 bind('pasteImage',async()=>{const items=await clipboard.read();for(const item of items){const mime=item.types.find(t=>['image/png','image/jpeg','image/webp','image/gif'].includes(t));if(mime){const blob=await item.getType(mime);if(blob.size>10*1024*1024)throw Error('粘贴图片最多10MB');return media.put({buffer:Buffer.from(await blob.arrayBuffer()),type:'image',name:'粘贴的图片.png'});}}return null;});
 bind('peerMedia',input=>media.fromData(input));
 bind('readMedia',input=>media.resolve(input?.id));
 bind('saveMessageSticker',input=>studioService.saveMessageSticker(input));
 bind('transcribe',async input=>{if(!plugins.getPublic().settings.voice)throw Error('请先开启语音插件');const b=input?.wavBase64;if(typeof b!=='string'||b.length>3e6||!/^[A-Za-z0-9+/]+={0,2}$/.test(b))throw Error('录音内容无效');const wav=Buffer.from(b,'base64');validateWav(wav,{recording:true});const result=await runSpeech('recognize',{wavBase64:b});const attachment=media.put({buffer:wav,type:'audio',name:'我的语音.wav'});return {...result,attachment};});
 bind('saveRecording',input=>{if(!plugins.getPublic().settings.voice)throw Error('先打开语音小开关，再把声音送过来呀。');const b=input?.wavBase64;if(typeof b!=='string'||b.length>3e6||!/^[A-Za-z0-9+/]+={0,2}$/.test(b))throw Error('这段录音没读完整，请重新录一次呀。');const wav=Buffer.from(b,'base64');if(wav.toString('base64')!==b)throw Error('录音编码不完整');validateWav(wav,{recording:true});return {attachment:media.put({buffer:wav,type:'audio',name:'我的声音.wav'})};});
 bind('stopSpeech',input=>voiceSession.stop(input?.conversationId?input.conversationId+':'+(input.messageId||''):undefined));
 bind('speak',async input=>{
  if(!plugins.getPublic().settings.voice)throw Error('先打开语音小开关，就能听见我啦。');
  const c=store.getConversation(input?.conversationId);if(!c)throw Error('这段聊天暂时没找到，重新打开后再听听吧。');const message=store.getMessages(c.id).find(m=>m.id===input?.messageId);
  const readable=speechText(message?.text||'');if(!readable)throw Error('这条消息只有表情或图片，还没有能念出的文字呀。');
  const existing=message.attachments?.find(a=>a.type==='audio');if(existing){voiceSession.stop();return {attachment:existing};}
  const a=c.agentId?agentById(c.agentId):null;
  return voiceSession.run(c.id+':'+message.id,async signal=>{
   const spoken=await runSpeech('speak',{text:readable.slice(0,3500),voice:a?.voice||''},{signal});
   if(signal.aborted)throw Error('这句先不念啦。');
   const attachment=media.fromData({dataUrl:spoken.audio,name:(a?.name||'小伙伴')+'的声音.wav',type:'audio'});
   const current=store.getMessages(c.id).find(m=>m.id===message.id);
   store.patchMessage(c.id,message.id,{attachments:[...(current.attachments||[]),attachment]});stateChanged();return {attachment,voice:spoken.voice};
  });
 });
 bind('copyText',async input=>{await clipboard.writeText(text(input?.text,150000));return true;});
 bind('exportAgent',input=>exportJSON('把角色卡送给朋友（带头像，不含密钥和私聊）',`哦鲸鲸角色-${Date.now()}.json`,exportRoleCard({store,media,agentId:input?.agentId})));
 bind('importAgent',async()=>{const d=await dialog.showOpenDialog(win,{title:'接一位新伙伴回家',properties:['openFile'],filters:[{name:'JSON角色卡',extensions:['json']}]});if(d.canceled)return null;const f=d.filePaths[0];if(fs.statSync(f).size>MAX_CARD_BYTES)throw Error('这张角色卡超过16MB啦，请缩小头像后重新导出。');const raw=fs.readFileSync(f,'utf8'),input=JSON.parse(raw);const archive=path.join(app.getPath('userData'),'role-card-imports');fs.mkdirSync(archive,{recursive:true});fs.writeFileSync(path.join(archive,Date.now()+'-'+crypto.randomUUID()+'.json'),raw,{flag:'wx',mode:0o600});const a=importRoleCard({store,media,input});stateChanged();return a;});
 bind('exportHistory',()=>{const s=store.getPublic();return exportJSON('导出聊天记录（包含私聊内容，不含密钥）',`哦鲸鲸聊天-${Date.now()}.json`,{app:'哦鲸鲸',version:app.getVersion(),exportedAt:new Date().toISOString(),conversations:s.conversations,messages:s.messages});});
 bind('recordPeer',input=>{
  const name=text(input?.name||'远方朋友',80);const peerId=text(input?.peerId,128);let c=input?.conversationId?store.getConversation(input.conversationId):null;
  if(c&&(c.type!=='peer'||c.peerId!==peerId))throw Error('连接会话不匹配');if(!c)c=store.createConversation({type:'peer',name,peerId});
  const m=input?.message;if(!m||typeof m.id!=='string'||m.id.length>128)throw Error('对端消息格式错误');const existing=store.getMessages(c.id).find(x=>x.id===m.id);if(existing)return {conversationId:c.id,message:existing};
  const ai=m.source==='ai'&&m.role==='assistant';const message=store.addMessage(c.id,{id:m.id,role:ai?'assistant':'peer',source:ai?'ai':'peer',text:text(m.text||''),attachments:media.validated(m.attachments),status:'sent',...(ai?{model:`对端提供 · ${text(m.model||'未知模型',150)}`}:{})});stateChanged();return {conversationId:c.id,message};
 });
 bind('recordPeerOutgoing',input=>{const c=store.getConversation(input?.conversationId);if(c.type!=='peer')throw Error('这不是对端会话');const id=text(input?.clientId,128);const existing=store.getMessages(c.id).find(m=>m.id===id);if(existing&&existing.role!=='user')throw Error('消息标识冲突');const patch={text:text(input.text||''),attachments:media.validated(input.attachments),status:['sent','pending','failed'].includes(input.status)?input.status:'sent'};const m=existing?store.patchMessage(c.id,id,patch):store.addMessage(c.id,{id,...patch,role:'user',source:'user'});stateChanged();return m;});
 bind('setPeerShare',input=>sharing.grant(input));
 bind('aiForPeer',input=>sharing.answer({...input,attachments:media.validated(input?.attachments)}));
 bind('shareStart',input=>sharing.startAPI(input));bind('shareStop',()=>sharing.stopAPI());bind('shareStatus',()=>sharing.status());
 bind('pluginConfigure',input=>{const r=plugins.configure(input);stateChanged();return r;});
 for(const method of ['remember','forgetMemory'])bind(method,input=>{const r=plugins[method](input);stateChanged();return r;});
 bind('addDiary',input=>{const r=plugins.addDiary({agentId:input?.agentId,text:text(input?.text||'',4000),source:'user'});stateChanged();return r;});
 bind('spacePost',input=>{const r=plugins.addPost({authorId:'me',source:'user',text:text(input?.text||'',4000),attachments:media.validated(input?.attachments)});stateChanged();return r;});
 bind('spaceLike',input=>{const r=plugins.toggleLike(input);stateChanged();return r;});
 bind('spaceComment',input=>{const r=plugins.addComment({postId:input?.postId,authorId:'me',source:'user',text:text(input?.text||'',1000)});stateChanged();return r;});
 bind('generateDiary',async input=>{
  if(!plugins.getPublic().settings.diary)throw Error('请先开启日常记录');const a=agentById(input?.agentId),c=store.getConversation(input?.conversationId);if(c.agentId!==a.id)throw Error('会话与角色不匹配');
  const day=localDay(new Date());const entries=store.getMessages(c.id).filter(m=>m.status==='sent'&&localDay(new Date(m.createdAt))===day).slice(-12);if(!entries.length)throw Error('今天还没有可记录的对话');
  return generateFor(a.id,async()=>{const r=await harness.replyExternal({agentId:a.id,text:`请把以下今天的对话写成一段100至200字的角色日记。只记录实际讨论的事情，区分虚构想象与真实发生，不推测未提及的隐私。\n${entries.map(m=>`${m.role==='user'?'我':'你'}：${m.text}`).join('\n').slice(-6500)}`});const d=plugins.addDiary({agentId:a.id,source:'ai',text:r.text.slice(0,4000),day});stateChanged();return d;});
 });
 bind('spaceGenerate',async input=>{
  if(!plugins.getPublic().settings.space)throw Error('请先开启空间功能');const a=agentById(input?.agentId);const prompt=text(input?.prompt||'',2000);const post=input?.postId?plugins.getPublic().posts.find(p=>p.id===input.postId):null;if(input?.postId&&!post)throw Error('动态不存在');
  return generateFor(a.id,async()=>{const r=await harness.replyExternal({agentId:a.id,text:post?`以你的角色语气，回复以下本机空间动态，60字以内。不要声称做过现实动作。动态文字：${post.text.slice(0,3500)}\n补充要求：${prompt}`:`为你自己的虚构角色写一条简短日常动态，100字以内。可以写心情、想吃的东西或一个想法，不要冒称进行了现实行动，不引用主人的私聊。主题：${prompt||'今天的小心情'}`});const result=post?plugins.addComment({postId:post.id,authorId:a.id,text:r.text.slice(0,1000),source:'ai'}):plugins.addPost({authorId:a.id,text:r.text.slice(0,4000),source:'ai',attachments:[]});stateChanged();return result;});
 });
}
async function generateFor(agentId,fn){if(generationJobs.has(agentId))throw Error('这个角色正在创作，请稍后再试');generationJobs.add(agentId);try{return await fn();}finally{generationJobs.delete(agentId);}}
async function checkGreetings(now=new Date()){try{return await proactive?.tick(now);}catch{emit({type:'notice',text:'这次问候还没送到，稍后会在次数上限内再试。'});}}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
 const dir=app.getPath('userData');fs.mkdirSync(dir,{recursive:true});
 store=new ChatStore({dir,encrypt:s=>{if(!safeStorage.isEncryptionAvailable())throw Error('本机凭据加密不可用，密钥未保存');return safeStorage.encryptString(s).toString('base64');},decrypt:s=>safeStorage.decryptString(Buffer.from(s,'base64'))});
 friends=new FriendsClient({dir:path.join(dir,'friends'),fetch:(...args)=>net.fetch(...args),encrypt:s=>{if(!safeStorage.isEncryptionAvailable())throw Error('本机凭据加密不可用');return safeStorage.encryptString(s).toString('base64');},decrypt:s=>safeStorage.decryptString(Buffer.from(s,'base64'))});
 managed=new ManagedClient({store,friends,fetch:(...args)=>net.fetch(...args)});
 media=new MediaStore({dir,nativeImage});
 plugins=new PluginStore({dir,validateAgent:agentById,validateAttachments:a=>media.validated(a)});
 harness=new Harness({store,managedRequest:input=>managed.request(input),fetch:(...args)=>net.fetch(...args),resolveImage:a=>media.resolve(a.id),onEvent:emit,contextForAgent:id=>{const p=plugins.getPublic();return [p.settings.stickers?'可偶尔用一个表情标记：[sticker:rice]开饭、[sticker:hello]招呼、[sticker:hug]安慰、[sticker:think]思考、[sticker:cheer]加油、[sticker:sleep]晚安；不必每条都使用。':'',plugins.contextForAgent(id)].filter(Boolean).join('\n').slice(0,4000);},log:record=>fs.appendFileSync(path.join(dir,'api-usage.jsonl'),JSON.stringify(record)+'\n')});
 groups=new GroupsClient({dir:path.join(dir,'groups'),friends,store,harness,media,onEvent:emit,encrypt:s=>{if(!safeStorage.isEncryptionAvailable())throw Error('本机群角色加密不可用');return safeStorage.encryptString(s).toString('base64');},decrypt:s=>safeStorage.decryptString(Buffer.from(s,'base64'))});groups.start();
 proactive=new ProactiveService({dir,store,harness,plugins,onChange:stateChanged,onNotify:result=>{
   if(!Notification.isSupported()||!win||win.isDestroyed()||win.isFocused())return;
   const a=store.getPublic().agents.find(a=>a.id===result.agentId);const note=new Notification({title:`${a?.name||'小鲸'}来找你啦`,body:'给你留了一条小小的问候，点开看看吧。',silent:true});
   note.on('click',()=>{if(!win||win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();emit({type:'open-conversation',conversationId:result.conversationId});});note.show();
 }});
 sharing=new ShareManager({reply:input=>harness.replyExternal(input),validateAgent:validateSharedAgent});
 studio=new StudioStore({dir,validateAttachment:a=>{const v=media.validated([a])[0];if(v.type!=='image')throw Error('素材须为图片');return v;}});
 knowledge=new KnowledgeStore({dir});
 studioService=new StudioService({dir,studio,knowledge,store,media,harness,onChange:stateChanged});
 // Explicit local launcher imports an authorized key without putting it in source, UI, or exports.
 if(process.env.LINGYU_ATLAS_KEY){if(!store.getPublic().providers.find(p=>p.id==='atlas')?.hasKey)store.saveProvider({id:'atlas',name:'AtlasCloud',baseUrl:'https://api.atlascloud.ai/v1',model:'deepseek-ai/deepseek-v4.1-flash',apiKey:process.env.LINGYU_ATLAS_KEY,vision:false,consent:true});delete process.env.LINGYU_ATLAS_KEY;}
 protocol.handle('lingyu-media',req=>{try{const u=new URL(req.url);if(u.hostname!=='asset'||req.method!=='GET')return new Response('',{status:404});const {meta,buffer}=media.get(u.pathname.slice(1));const headers={'Access-Control-Allow-Origin':'null','Content-Type':meta.mime,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Content-Length':String(buffer.length),'Accept-Ranges':'bytes'};const range=req.headers.get('range');if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m)return new Response('',{status:416});const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),buffer.length-1):buffer.length-1;if(start>end||start>=buffer.length)return new Response('',{status:416});return new Response(buffer.subarray(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${buffer.length}`,'Content-Length':String(end-start+1)}});}return new Response(buffer,{headers});}catch{return new Response('',{status:404});}});
 win=new BrowserWindow({width:1440,height:920,minWidth:1000,minHeight:680,title:'哦鲸鲸',icon:path.join(__dirname,'ui/app.ico'),backgroundColor:'#f3f7fc',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(url!==uiURL)event.preventDefault();});
 const ses=win.webContents.session;ses.setPermissionRequestHandler((wc,permission,cb,detail)=>cb(wc===win.webContents&&wc.getURL()===uiURL&&permission==='media'&&!!detail.mediaTypes?.length&&detail.mediaTypes.every(t=>t==='audio'||t==='video')));ses.setPermissionCheckHandler((wc,p)=>wc===win.webContents&&wc.getURL()===uiURL&&p==='media');
 win.on('close',event=>{if(closeCommitted)return;event.preventDefault();if(closing)return;closing=true;closeTimer=setTimeout(()=>{closing=false;dialog.showErrorBox('正在保存草稿','窗口保留打开，以免丢失内容。请稍后再关闭。');},8000);win.webContents.send('ly:closing');});
 installBridge();installStudioBridge({bind,studio,service:studioService,knowledge,dialog,win,exportJSON});await win.loadURL(uiURL);runSpeech('info').then(info=>{speechInfo=info;stateChanged();}).catch(()=>{});
 greetingTimer=setInterval(()=>checkGreetings(),60000);setTimeout(()=>checkGreetings(),20000);
}).catch(error=>{dialog.showErrorBox('哦鲸鲸未能启动',error.message);app.quit();});
app.on('window-all-closed',()=>{clearInterval(greetingTimer);groups?.dispose();proactive?.dispose();app.quit();});
app.on('before-quit',()=>{clearInterval(greetingTimer);groups?.dispose();proactive?.dispose();voiceSession.stop();sharing?.revokeAll();});
