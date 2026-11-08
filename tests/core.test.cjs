'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const {ChatStore}=require('../src/core/store.cjs');
function fixture(options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lingyu-store-test-'));const key=crypto.randomBytes(32);
  const encrypt=text=>{const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');};
  const decrypt=value=>{const b=Buffer.from(value,'base64');const cipher=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');};
  const args={dir,encrypt,decrypt,...options};return {store:new ChatStore(args),args,dir};
}
const p={id:'custom',name:'测试服务',baseUrl:'https://example.test/v1',model:'test-model',vision:false,consent:true,apiKey:'test-key-unique-private'};
const media={id:'photo-1',type:'image',mime:'image/png',name:'image.png',url:'lingyu-media://asset/photo-1',bytes:8};
test('initial store is empty, has eight fictional cards and no prefilled conversations',()=>{
  const {store}=fixture();const state=store.getPublic();assert.equal(state.schema,1);assert.equal(state.agents.length,8);assert.deepEqual(state.conversations,[]);assert.deepEqual(state.messages,{});assert.equal(state.providers[0].id,'atlas');assert.equal(state.providers[0].hasKey,false);assert.equal(state.providers[0].vision,false);assert.equal(state.agents[0].avatar,'assets/deepseek-avatar.png');assert.ok(state.agents.every(a=>!a.memory&&!a.greeting.enabled));
  state.agents[0].name='mutated';assert.notEqual(store.getPublic().agents[0].name,'mutated');
});
test('legacy greeting settings remain readable while new cadence and background preference survive restart',()=>{
 const {store,args}=fixture();
 store.saveAgent({id:'deepseek',greeting:{enabled:true,hour:9}});
 assert.equal(store.getPublic().agents[0].greeting.mode,'daily');
 assert.throws(()=>store.saveAgent({id:'deepseek',greeting:{enabled:true,hour:9,mode:'always'}}),/问候节奏/);
 store.saveAgent({id:'deepseek',greeting:{enabled:true,hour:9,mode:'natural'}});
 assert.throws(()=>store.updateSettings({proactive:{background:'yes'}}),/开关值/);
 assert.throws(()=>store.updateSettings({proactive:{background:true,secret:'not-allowed'}}));
 store.updateSettings({proactive:{background:true}});
 const restored=new ChatStore(args).getPublic();assert.equal(restored.agents[0].greeting.mode,'natural');assert.equal(restored.settings.proactive.background,true);
});
test('snapshots are append-only, restart restores history and only ciphertext is persisted',()=>{
  const {store,args,dir}=fixture();const initial=fs.readdirSync(dir);const old=fs.readFileSync(path.join(dir,initial[0]),'utf8');
  const result=store.saveProvider(p);assert.equal(result.hasKey,true);assert.equal(result.apiKey,undefined);assert.equal(result.encryptedApiKey,undefined);
  const c=store.createConversation({agentId:'deepseek',type:'ai'});store.addMessage(c.id,{role:'user',text:'persisted text',source:'user'});store.saveDraft({conversationId:c.id,text:'draft'});
  assert.equal(fs.readFileSync(path.join(dir,initial[0]),'utf8'),old);assert.ok(fs.readdirSync(dir).length>=5);
  for(const file of fs.readdirSync(dir))assert.ok(!fs.readFileSync(path.join(dir,file),'utf8').includes(p.apiKey));
  const again=new ChatStore(args);assert.equal(again.getProvider(p.id).apiKey,p.apiKey);assert.equal(again.getMessages(c.id)[0].text,'persisted text');assert.equal(again.getPublic().drafts[c.id],'draft');
});
test('blank key preserves same endpoint; endpoint changes clear previous key unless replaced',()=>{
  const {store}=fixture();store.saveProvider(p);store.saveProvider({id:p.id,apiKey:'',model:'another'});assert.equal(store.getProvider(p.id).apiKey,p.apiKey);
  store.saveProvider({id:p.id,baseUrl:'https://other.test/v1',apiKey:''});assert.equal(store.getProvider(p.id).apiKey,'');
  store.saveProvider({id:p.id,baseUrl:'https://third.test/v1',apiKey:'replacement'});assert.equal(store.getProvider(p.id).apiKey,'replacement');
});
test('failed encryption never mutates provider or persists plaintext fallback',()=>{
  const {store}=fixture({encrypt:()=>{throw new Error('simulated OS failure');}});assert.throws(()=>store.saveProvider(p),/加密失败/);assert.equal(store.getPublic().providers.length,1);
  assert.throws(()=>new ChatStore({dir:os.tmpdir()}),/加密服务/);
});
test('decrypt errors are explicit and public state does not contain secrets',()=>{
  const {store,args}=fixture();store.saveProvider(p);const broken=new ChatStore({...args,decrypt:()=>{throw new Error('key lost');}});assert.throws(()=>broken.getProvider(p.id),/重新保存/);assert.ok(!JSON.stringify(broken.getPublic()).includes('encryptedApiKey'));
});
test('strict endpoint policy blocks credentials, queries, fragments, public HTTP and foreign schemes',()=>{
  const {store}=fixture();for(const baseUrl of ['http://example.test/v1','file:///tmp/x','https://name:secret@example.test','https://@example.test','https://example.test?v=1','https://example.test?','https://example.test#','https://example.test/#a','https://example.test/#/v1'])assert.throws(()=>store.saveProvider({...p,baseUrl}),/地址/);
  for(const baseUrl of ['http://localhost:11434/v1','http://127.0.0.1:8000/v1','http://[::1]:8000/v1','https://example.test/v1/'])assert.ok(store.saveProvider({...p,baseUrl}));
});
test('newest corrupt/incomplete snapshots are ignored and valid history remains recoverable',()=>{
  const {store,args,dir}=fixture();store.updateSettings({displayName:'保存成功'});fs.writeFileSync(path.join(dir,'snapshot-9999999999999999-abcdef.json'),'{"broken":');
  assert.equal(new ChatStore(args).getPublic().settings.displayName,'保存成功');
});
test('when all snapshots are corrupt the store refuses silent reset',()=>{
  const {args,dir}=fixture();for(const file of fs.readdirSync(dir))fs.writeFileSync(path.join(dir,file),'bad');assert.throws(()=>new ChatStore(args),/没有可读取/);
});
test('card import is allowlisted, unique and unbound; private memory is only explicitly saved',()=>{
  const {store}=fixture();store.saveAgent({id:'deepseek',memory:'explicit private note',greeting:{enabled:true,hour:11}});const card=store.exportAgent('deepseek');assert.equal(card.memory,undefined);assert.equal(card.providerId,undefined);assert.equal(card.messages,undefined);assert.equal(card.greeting,undefined);assert.equal(store.getPublic().agents[0].memory,'explicit private note');
  const imported=store.importAgent({...card,id:'deepseek',providerId:'atlas',memory:'imported private text',greeting:{enabled:true,hour:3},apiKey:'NEVER',messages:['leak'],extra:'bad'});assert.notEqual(imported.id,'deepseek');assert.equal(imported.providerId,'');assert.equal(imported.memory,'');assert.equal(imported.greeting.enabled,false);assert.equal(imported.apiKey,undefined);assert.equal(imported.messages,undefined);assert.equal(store.getPublic().agents.length,9);
});
test('agent and settings validation rejects oversized and mistyped values',()=>{
  const {store}=fixture();assert.throws(()=>store.saveAgent({id:'deepseek',persona:'x'.repeat(12001)}),/角色设定/);assert.throws(()=>store.saveAgent({id:'deepseek',avatar:'file:///C:/private.png'}),/头像/);assert.throws(()=>store.saveAgent({id:'deepseek',providerId:'missing'}),/服务不存在/);assert.throws(()=>store.saveAgent({id:'deepseek',greeting:{enabled:true,hour:24}}),/范围/);assert.throws(()=>store.updateSettings({autoVoice:'yes'}),/开关值/);assert.throws(()=>store.updateSettings({theme:'blue'}),/主题/);
  store.updateSettings({displayName:'测试用户',quietHours:{enabled:true,start:22,end:8}});assert.equal(store.getPublic().settings.quietHours.start,22);
});
test('conversations, quotes, drafts and status updates persist without mutating identity',()=>{
  const {store,args}=fixture();const c=store.createConversation({agentId:'deepseek',type:'ai'});const u=store.addMessage(c.id,{id:'u1',role:'user',text:'hi',source:'user',attachments:[media]});const a=store.addMessage(c.id,{role:'assistant',text:'',status:'pending',source:'ai',replyTo:u.id});store.patchMessage(c.id,a.id,{text:'hello',status:'sent',id:'replaced',role:'system'});store.setConversation({id:c.id,pinned:true,archived:true,read:true});
  const reloaded=new ChatStore(args);assert.equal(reloaded.getMessages(c.id)[1].role,'assistant');assert.equal(reloaded.getMessages(c.id)[1].id,a.id);assert.equal(reloaded.getMessages(c.id)[1].replyTo,u.id);assert.equal(reloaded.getConversation(c.id).pinned,true);assert.equal(reloaded.getConversation(c.id).read,true);
});
test('message and media boundaries block paths, unsafe IDs, bad MIME and missing quotes',()=>{
  const {store}=fixture();const c=store.createConversation({agentId:'deepseek'});const base={role:'user',text:'x',source:'user'};
  for(const invalid of [{...media,url:'file:///C:/secret.png'},{...media,mime:'image/svg+xml'},{...media,id:'../secret'},{...media,bytes:0}])assert.throws(()=>store.addMessage(c.id,{...base,attachments:[invalid]}));
  assert.throws(()=>store.addMessage(c.id,{...base,replyTo:'missing'}),/引用/);assert.throws(()=>store.addMessage(c.id,{...base,id:'__proto__'}),/标识/);assert.throws(()=>store.addMessage(c.id,{...base,role:'developer'}),/消息角色/);assert.throws(()=>store.addMessage(c.id,{...base,text:'x'.repeat(200001)}),/消息正文/);assert.equal(store.getMessages(c.id).length,0);
});
test('duplicate client IDs fail, pending assistant statuses survive disk and greeting ledger is explicit',()=>{
  const {store,args}=fixture();const c=store.createConversation({agentId:'deepseek'});store.addMessage(c.id,{id:'dedupe',role:'user',text:'only one'});assert.throws(()=>store.addMessage(c.id,{id:'dedupe',role:'user',text:'duplicate'}),/重复/);store.markGreeting('deepseek','2026-11-05');assert.equal(new ChatStore(args).getPublic().greetings.deepseek,'2026-11-05');assert.equal(store.getMessages(c.id).length,1);
});
test('restart recovers interrupted pending messages as failed rather than leaving a permanent spinner',()=>{
  const {store,args,dir}=fixture();const c=store.createConversation({agentId:'deepseek'});store.addMessage(c.id,{role:'user',text:'question',source:'user'});store.addMessage(c.id,{role:'assistant',text:'partial',status:'pending',source:'ai'});const before=fs.readdirSync(dir).length;
  const again=new ChatStore(args);assert.equal(again.getMessages(c.id)[0].status,'sent');assert.equal(again.getMessages(c.id)[1].status,'failed');assert.equal(again.getMessages(c.id)[1].text,'partial');assert.equal(fs.readdirSync(dir).length,before+1);
});


test('stable friend sessions get or create synchronously, retaining history and explicit archive state',()=>{
 const {store,args,dir}=fixture();const peerId='friend:'+'a'.repeat(32),input={type:'peer',peerId,name:'同一位朋友'};const first=store.createConversation(input);store.addMessage(first.id,{role:'peer',source:'peer',text:'原来的消息'});store.setConversation({id:first.id,archived:true});const count=fs.readdirSync(dir).length;
 const same=store.createConversation({...input,name:'不重建会话'});assert.equal(same.id,first.id);assert.equal(same.archived,true);assert.equal(store.getMessages(same.id)[0].text,'原来的消息');assert.equal(fs.readdirSync(dir).length,count);same.name='外部修改';assert.equal(store.getConversation(first.id).name,'同一位朋友');
 const restored=new ChatStore(args);assert.equal(restored.createConversation(input).id,first.id);assert.equal(restored.getPublic().conversations.length,1);
 const temporary={type:'peer',peerId:'temporary-session',name:'临时连接'};assert.notEqual(store.createConversation(temporary).id,store.createConversation(temporary).id);
 assert.notEqual(store.createConversation({type:'ai',agentId:'deepseek'}).id,store.createConversation({type:'ai',agentId:'deepseek'}).id);
});
