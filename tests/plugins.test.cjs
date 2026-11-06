'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const {PluginStore}=require('../src/core/plugins.cjs');const {validateAttachments}=require('../src/core/store.cjs');
function fixture(extra={}) {const args={dir:fs.mkdtempSync(path.join(os.tmpdir(),'lingyu-plugins-test-')),validateAgent:id=>{if(!['deepseek','qwen'].includes(id))throw new Error('未知角色');},validateAttachments,...extra};return {args,dir:args.dir,store:new PluginStore(args)};}
function snapshot(dir,state,sequence=9999999999999999) {const file=path.join(dir,`plugins-${sequence}-abcdef.json`);const record={schema:1,sequence,sha256:crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex'),state};fs.writeFileSync(file,JSON.stringify(record));return file;}
const photo={id:'photo',type:'image',mime:'image/png',name:'photo.png',url:'lingyu-media://asset/photo',bytes:20};
test('six local modules start enabled without fake memories, diary or space activity',()=>{
  const {store}=fixture();const state=store.getPublic();assert.deepEqual(Object.keys(state).sort(),['catalog','diary','memories','posts','settings']);assert.deepEqual(state.settings,{memory:true,stickers:true,voice:true,diary:true,proactive:true,space:true});assert.equal(state.catalog.length,6);assert.ok(state.catalog.every(row=>row.native&&row.status==='内置模块'&&row.enabled));assert.ok(state.catalog.find(row=>row.id==='space').description.includes('不登录'));assert.deepEqual(state.memories,[]);assert.deepEqual(state.diary,[]);assert.deepEqual(state.posts,[]);state.settings.memory=false;assert.equal(store.getPublic().settings.memory,true);
});
test('memory only changes through explicit API, persists, and forgetting is a soft deactivation',()=>{
  const {store,args,dir}=fixture();const originals=fs.readdirSync(dir);const original=fs.readFileSync(path.join(dir,originals[0]),'utf8');const row=store.remember({agentId:'deepseek',text:'用户确认的偏好',pinned:true});assert.deepEqual({...row,id:null,createdAt:null},{id:null,agentId:'deepseek',text:'用户确认的偏好',pinned:true,createdAt:null,active:true,usedAt:null});
  store.forgetMemory({id:row.id});const again=new PluginStore(args);assert.equal(again.getPublic().memories.length,1);assert.equal(again.getPublic().memories[0].active,false);assert.equal(again.contextForAgent('deepseek'),'');assert.equal(fs.readFileSync(path.join(dir,originals[0]),'utf8'),original);assert.ok(fs.readdirSync(dir).length>=3);
});
test('memory retrieval prioritizes pinned and then newest, isolates agent, and updates usedAt only for selected rows',()=>{
  const {store,args}=fixture();const old=store.remember({agentId:'deepseek',text:'PINNED_FIRST',pinned:true});const unselected=store.remember({agentId:'deepseek',text:'old-unselected'});for(let i=0;i<9;i++)store.remember({agentId:'deepseek',text:`new-${i}`});store.remember({agentId:'qwen',text:'OTHER_AGENT_PRIVATE'});const context=store.contextForAgent('deepseek');const lines=context.split('\n');assert.equal(lines.length,8);assert.ok(lines[0].includes('PINNED_FIRST'));assert.ok(lines[1].includes('new-8'));assert.ok(!context.includes('OTHER_AGENT_PRIVATE'));assert.ok(!context.includes('old-unselected'));
  const state=new PluginStore(args).getPublic();assert.ok(state.memories.find(m=>m.id===old.id).usedAt);assert.equal(state.memories.find(m=>m.id===unselected.id).usedAt,null);
});
test('retrieval never exceeds 4000 characters, including formatting or escaped memory strings',()=>{
  const {store}=fixture();for(let i=0;i<10;i++)store.remember({agentId:'deepseek',text:`${i} ${'x'.repeat(998)}`});const result=store.contextForAgent('deepseek');assert.ok(result.length<=4000);assert.equal(result.split('\n').length,3);assert.ok(result.includes('9 '));
  const {store:escaped}=fixture();escaped.remember({agentId:'deepseek',text:'\u0001'.repeat(1000)});assert.equal(escaped.contextForAgent('deepseek'),'');
});
test('disabling memory excludes all retrieval and new writes; forgetting remains possible',()=>{
  const {store}=fixture();const row=store.remember({agentId:'deepseek',text:'private'});store.configure({id:'memory',enabled:false});assert.equal(store.contextForAgent('deepseek'),'');assert.throws(()=>store.remember({agentId:'deepseek',text:'new'}),/关闭/);assert.equal(store.forgetMemory({id:row.id}).active,false);assert.equal(store.getPublic().catalog.find(p=>p.id==='memory').enabled,false);
});
test('diary preserves text, date and source without rewriting earlier entries',()=>{
  const {store,args}=fixture();const user=store.addDiary({agentId:'deepseek',text:'用户原文\n第二行',source:'user',day:'2026-11-05'});const ai=store.addDiary({agentId:'deepseek',text:'明确请求生成的日记',source:'ai',day:'2026-11-05'});assert.notEqual(user.id,ai.id);const rows=new PluginStore(args).getPublic().diary;assert.equal(rows.length,2);assert.equal(rows[0].text,'用户原文\n第二行');assert.equal(rows[0].source,'user');assert.equal(rows[1].source,'ai');assert.equal(rows[0].day,'2026-11-05');
});
test('activity stores date counts only and never invents diary entries or comments',()=>{
  const {store,args}=fixture();const first=store.recordActivity({agentId:'deepseek'});const second=store.recordActivity({agentId:'deepseek'});assert.equal(first.count,1);assert.equal(second.count,2);assert.equal(first.day,second.day);assert.equal(new PluginStore(args).recordActivity({agentId:'deepseek'}).count,3);assert.deepEqual(store.getPublic().diary,[]);assert.deepEqual(store.getPublic().posts,[]);
});
test('space writes only explicit posts, likes, and comments with honest separate source labels',()=>{
  const {store,args}=fixture();const post=store.addPost({authorId:'me',text:'本机动态',attachments:[photo],source:'user'});assert.equal(post.comments.length,0);assert.equal(post.liked,false);assert.equal(store.toggleLike({postId:post.id}).liked,true);const comment=store.addComment({postId:post.id,authorId:'deepseek',text:'显式生成的 AI 评论',source:'ai'});assert.equal(comment.source,'ai');store.addComment({postId:post.id,authorId:'me',text:'用户评论',source:'user'});assert.equal(store.toggleLike({postId:post.id}).liked,false);const again=new PluginStore(args).getPublic();assert.equal(again.posts.length,1);assert.equal(again.posts[0].comments.length,2);assert.equal(again.posts[0].comments[0].authorId,'deepseek');assert.equal(again.posts[0].attachments[0].url,photo.url);
});
test('media is validated locally; filesystem/remote URLs and extra secret fields cannot enter posts',()=>{
  let checks=0;const {store}=fixture({validateAttachments:items=>{checks++;return validateAttachments(items);}});assert.throws(()=>store.addPost({authorId:'me',text:'bad',attachments:[{...photo,url:'file:///C:/secret.png'}],source:'user'}),/附件/);assert.throws(()=>store.addPost({authorId:'me',text:'bad',attachments:[{...photo,url:'https://attacker.test/a.png'}],source:'user'}),/附件/);store.addPost({authorId:'me',text:'okay',attachments:[{...photo,apiKey:'MUST_NOT_PERSIST'}],source:'user'});assert.ok(checks>0);assert.ok(!JSON.stringify(store.getPublic()).includes('MUST_NOT_PERSIST'));
});
test('feature toggles disable their writes without erasing saved content',()=>{
  const {store}=fixture();store.addDiary({agentId:'deepseek',text:'keep',source:'user'});store.configure({id:'diary',enabled:false});assert.throws(()=>store.addDiary({agentId:'deepseek',text:'no',source:'user'}),/关闭/);assert.equal(store.recordActivity({agentId:'deepseek'}).count,0);const post=store.addPost({authorId:'me',text:'keep',source:'user'});store.configure({id:'space',enabled:false});assert.throws(()=>store.addPost({authorId:'me',text:'no',source:'user'}),/关闭/);assert.throws(()=>store.toggleLike({postId:post.id}),/关闭/);assert.throws(()=>store.addComment({postId:post.id,authorId:'me',text:'no',source:'user'}),/关闭/);assert.equal(store.getPublic().diary.length,1);assert.equal(store.getPublic().posts.length,1);
});
test('loaded snapshots validate schema and hash and fall back from corrupt or invalid newest entries',()=>{
  const {store,args,dir}=fixture();store.remember({agentId:'deepseek',text:'valid memory'});const latest=fs.readdirSync(dir).sort().at(-1);const valid=JSON.parse(fs.readFileSync(path.join(dir,latest),'utf8')).state;
  snapshot(dir,{...valid,settings:{...valid.settings,memory:'false'}});assert.equal(new PluginStore(args).getPublic().settings.memory,true);
  snapshot(dir,{...valid,memories:[{...valid.memories[0],agentId:'unknown'}]});assert.equal(new PluginStore(args).getPublic().memories[0].text,'valid memory');
  const corrupt=snapshot(dir,valid);const raw=JSON.parse(fs.readFileSync(corrupt,'utf8'));raw.state.memories[0].text='tampered';fs.writeFileSync(corrupt,JSON.stringify(raw));assert.equal(new PluginStore(args).getPublic().memories[0].text,'valid memory');
});
test('extra secret-bearing snapshot fields are rejected even with a matching checksum',()=>{
  const {store,args,dir}=fixture();store.addPost({authorId:'me',text:'valid',attachments:[photo],source:'user'});const latest=fs.readdirSync(dir).sort().at(-1);const state=JSON.parse(fs.readFileSync(path.join(dir,latest),'utf8')).state;state.posts[0].attachments[0].apiKey='NEVER_PUBLIC';snapshot(dir,state);const again=new PluginStore(args);assert.ok(!JSON.stringify(again.getPublic()).includes('NEVER_PUBLIC'));
});
test('total corruption fails visibly rather than silently replacing the plugin history',()=>{
  const {args,dir}=fixture();for(const file of fs.readdirSync(dir))fs.writeFileSync(path.join(dir,file),'{');assert.throws(()=>new PluginStore(args),/没有可读取/);
});
test('validation rejects oversized/mistyped sources, invalid dates/roles, unknown fields and prototype IDs',()=>{
  const {store}=fixture();for(const text of ['',' ','x'.repeat(1001)])assert.throws(()=>store.remember({agentId:'deepseek',text}),/记忆内容/);assert.throws(()=>store.remember({agentId:'unknown',text:'x'}),/未知角色/);assert.throws(()=>store.remember({agentId:'deepseek',text:'x',pinned:'true'}),/开关值/);assert.throws(()=>store.remember({agentId:'deepseek',text:'x',apiKey:'secret'}),/不支持/);assert.throws(()=>store.configure({id:'remote-exec',enabled:true}),/未知/);assert.throws(()=>store.configure({id:'memory',enabled:1}),/开关值/);assert.throws(()=>store.addDiary({agentId:'deepseek',text:'x',source:'system'}),/来源/);assert.throws(()=>store.addDiary({agentId:'deepseek',text:'x',source:'user',day:'2026-02-30'}),/日期/);assert.throws(()=>store.addPost({authorId:'unknown',text:'x',source:'user'}),/未知角色/);assert.throws(()=>store.addPost({authorId:'me',text:' ',source:'user'}),/不能为空/);assert.throws(()=>store.toggleLike({postId:'__proto__'}),/标识/);assert.throws(()=>store.forgetMemory({id:'missing'}),/不存在/);
  const p=store.addPost({authorId:'me',text:'post',source:'user'});assert.throws(()=>store.addComment({postId:p.id,authorId:'me',text:'x'.repeat(2001),source:'user'}),/评论内容/);assert.throws(()=>store.addDiary({agentId:'deepseek',text:'x'.repeat(10001),source:'user'}),/日记内容/);
});
test('missing or async validators are rejected instead of persisting unvalidated references',()=>{
  assert.throws(()=>new PluginStore({dir:os.tmpdir()}),/验证服务/);const {store}=fixture({validateAgent:async()=>{}});assert.throws(()=>store.remember({agentId:'deepseek',text:'x'}),/同步/);const {store:media}=fixture({validateAttachments:async a=>a});assert.throws(()=>media.addPost({authorId:'me',text:'x',source:'user'}),/同步/);
});
