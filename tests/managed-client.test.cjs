'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ChatStore}=require('../src/core/store.cjs'),{FriendsClient}=require('../src/core/friends-client.cjs'),{ManagedClient}=require('../src/core/managed-client.cjs'),{Harness}=require('../src/core/harness.cjs');
const ORIGIN='https://managed.example',MODEL='deepseek-ai/deepseek-test',TOKEN=crypto.randomBytes(32).toString('base64url');
const SELF={id:'1'.repeat(32),code:'JW-ABCD-EFGH-JKLM',name:'一位鲸友'};
const CATALOG={enabled:true,models:[{id:MODEL,name:'DeepSeek测试',vision:false}],limits:{perMinute:6,perDay:60,concurrent:1,globalPerDay:600,maxOutputTokens:4096},privacy:{processor:'AtlasCloud',region:'Hong Kong server; upstream processing location not verified'}};
const reply=(text='托管实际测试回复')=>({choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}});
function fixture(options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-managed-test-')),key=crypto.randomBytes(32),requests=[],logs=[],events=[];
 const encrypt=s=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([c.update(s),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');};
 const decrypt=s=>{const b=Buffer.from(s,'base64'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString();};
 const storeArgs={dir:path.join(dir,'chat'),encrypt,decrypt,managedOrigin:ORIGIN},store=new ChatStore(storeArgs);
 const fetch=async(url,input)=>{requests.push({url,input});if(url.endsWith('/models'))return new Response(JSON.stringify(options.catalog||CATALOG));if(url.endsWith('/register'))return new Response(JSON.stringify({self:SELF,token:TOKEN}));if(url.endsWith('/usage'))return new Response(JSON.stringify({day:'2026-11-05',requestsUsed:1,requestsRemaining:59,perMinute:6,perDay:60,concurrent:1}));return options.chat?options.chat(url,input):new Response(JSON.stringify(reply()));};
 const friendArgs={dir:path.join(dir,'friends'),serverUrl:ORIGIN,fetch,encrypt,decrypt},friends=new FriendsClient(friendArgs),managed=new ManagedClient({store,friends,fetch});let byok=0;const harness=new Harness({store,fetch:()=>{byok++;throw Error('No BYOK request expected');},managedRequest:i=>managed.request(i),log:r=>logs.push(r),onEvent:e=>events.push(e),contextForAgent:()=>options.memory||''});
 return {dir,store,storeArgs,friends,friendArgs,managed,harness,requests,logs,events,byok:()=>byok};
}
const connect=x=>x.managed.connect({agentId:'deepseek',model:MODEL,consent:true});
test('managed proactive generation uses 512 tokens and keeps its result outside chat until reviewed',async()=>{
 const x=fixture();await connect(x);const c=x.store.createConversation({agentId:'deepseek'});
 const result=await x.harness.generateGreeting({conversationId:c.id,greetingContext:'请发一条自然的主动问候。'});
 assert.equal(result.text,'托管实际测试回复');assert.equal(x.store.getMessages(c.id).length,0);assert.equal(x.events.length,0);
 const body=JSON.parse(x.requests.at(-1).input.body);assert.equal(body.max_tokens,512);
 const provider=x.store.getProvider(x.store.getPublic().agents.find(a=>a.id==='deepseek').providerId),count=x.requests.length;
 for(const maxTokens of [0,-1,1.5,4097,'512'])await assert.rejects(x.managed.request({provider,messages:[{role:'user',content:'test'}],maxTokens}),/输出长度/);
 assert.equal(x.requests.length,count);
 await x.managed.request({provider,messages:[{role:'user',content:'普通消息'}]});assert.equal(JSON.parse(x.requests.at(-1).input.body).max_tokens,4096);
});
test('managed unknown upstream error code still preserves HTTP 429 for proactive backoff',async()=>{
 const x=fixture({chat:()=>new Response(JSON.stringify({error:{code:'UNKNOWN_RATE_FIXTURE'}}),{status:429})});await connect(x);const c=x.store.createConversation({agentId:'deepseek'});
 await assert.rejects(x.harness.generateGreeting({conversationId:c.id,greetingContext:'请发一条自然的问候。'}),error=>error.status===429&&error.code==='FRIENDS_HTTP');assert.equal(x.store.getMessages(c.id).length,0);
});
test('managed catalog is public and opt-in is required before registering or rebinding a role',async()=>{
 const x=fixture();assert.deepEqual(await x.managed.catalog(),CATALOG);assert.equal(x.friends.status().enabled,false);assert.equal(x.requests[0].input.headers.Authorization,undefined);
 await assert.rejects(x.managed.connect({agentId:'deepseek',model:MODEL,consent:false}),/确认/);assert.equal(x.requests.length,1);
 await assert.rejects(x.managed.connect({agentId:'deepseek',model:'foreign/unsupported',consent:true}),/名单/);assert.equal(x.requests.filter(r=>r.url.endsWith('/register')).length,0);
 const disabled=fixture({catalog:{...CATALOG,enabled:false,models:[]}});await assert.rejects(connect(disabled),/没开启/);assert.equal(disabled.friends.status().enabled,false);
});
test('connection stores a managed provider without a key, preserves BYOK and survives encrypted identity restart',async()=>{
 const x=fixture();x.store.saveProvider({id:'atlas',apiKey:'BYOK_LOCAL_SECRET',consent:true});const result=await connect(x);assert.equal(result.provider.managed,true);assert.equal(result.provider.hasKey,false);assert.equal(Object.hasOwn(x.store.getProvider(result.provider.id),'apiKey'),false);assert.equal(x.store.getProvider('atlas').apiKey,'BYOK_LOCAL_SECRET');
 assert.equal(x.requests.filter(r=>r.url.endsWith('/register')).length,1);await connect(x);assert.equal(x.requests.filter(r=>r.url.endsWith('/register')).length,1);
 assert.throws(()=>x.store.saveProvider({id:result.provider.id,baseUrl:'https://evil.example'}),/一键连接/);assert.throws(()=>x.store.saveProvider({id:'arbitrary',managed:true,baseUrl:ORIGIN,model:MODEL}),/一键连接/);assert.throws(()=>x.store.saveProvider({id:'managed-override',baseUrl:ORIGIN,model:MODEL}),/一键连接/);
 for(const folder of [x.store.dir,x.friends.dir])for(const file of fs.readdirSync(folder))if(file.endsWith('.json'))assert.ok(!fs.readFileSync(path.join(folder,file),'utf8').includes(TOKEN));assert.ok(!JSON.stringify(x.store.getPublic()).includes(TOKEN));
 const restored=new ChatStore(x.storeArgs),identity=new FriendsClient(x.friendArgs);assert.equal(restored.getProvider(result.provider.id).managed,true);assert.equal(identity.status().self.id,SELF.id);assert.equal(restored.getPublic().agents[0].providerId,result.provider.id);
});
test('managed Harness uses role and confirmed memory through device-auth route, never BYOK or leaked credentials',async()=>{
 const x=fixture({memory:'PLUGIN_CONFIRMED_PRIVATE'});await connect(x);x.store.saveAgent({id:'deepseek',memory:'OWNER_CONFIRMED_PRIVATE'});const c=x.store.createConversation({agentId:'deepseek',type:'ai'});const result=await x.harness.send({conversationId:c.id,text:'用户这次愿意发送的文字'});assert.equal(result.message.text,'托管实际测试回复');assert.equal(result.message.status,'sent');assert.equal(x.byok(),0);
 const request=x.requests.find(r=>r.url.endsWith('/managed/chat/completions'));assert.equal(request.input.headers.Authorization,'Bearer '+TOKEN);const body=JSON.parse(request.input.body);assert.equal(body.stream,false);assert.equal(body.max_tokens,4096);assert.ok(body.messages[0].content.includes('OWNER_CONFIRMED_PRIVATE'));assert.ok(body.messages[0].content.includes('PLUGIN_CONFIRMED_PRIVATE'));assert.ok(body.messages[0].content.includes('角色设定'));
 const external=await x.harness.replyExternal({agentId:'deepseek',text:'访客问题'});assert.equal(external.text,'托管实际测试回复');const shared=JSON.parse(x.requests.at(-1).input.body);assert.ok(!JSON.stringify(shared).includes('OWNER_CONFIRMED_PRIVATE'));assert.ok(!JSON.stringify(shared).includes('PLUGIN_CONFIRMED_PRIVATE'));assert.equal(shared.messages.length,2);
 for(const value of [TOKEN,'OWNER_CONFIRMED_PRIVATE','PLUGIN_CONFIRMED_PRIVATE','用户这次愿意发送的文字'])assert.ok(!JSON.stringify(x.logs).includes(value));
});
test('managed quota failure preserves question and failed reply without automatic retry or BYOK fallback',async()=>{
 const x=fixture({chat:()=>new Response(JSON.stringify({error:{code:'USER_DAILY_LIMIT',message:'SECRET_UPSTREAM_DETAIL'}}),{status:429})});await connect(x);const c=x.store.createConversation({agentId:'deepseek',type:'ai'});await assert.rejects(x.harness.send({conversationId:c.id,text:'请保留我的问题'}),e=>e.code==='USER_DAILY_LIMIT'&&e.status===429&&/UTC/.test(e.message)&&!e.message.includes('SECRET_UPSTREAM_DETAIL'));
 const history=x.store.getMessages(c.id);assert.equal(history[0].text,'请保留我的问题');assert.equal(history[1].status,'failed');assert.equal(x.requests.filter(r=>r.url.endsWith('/chat/completions')).length,1);assert.equal(x.byok(),0);
});
test('managed cancellation aborts the native-compatible fetch and retains user text with cancelled status',async()=>{
 let ready;const started=new Promise(r=>ready=r);let cancelled=false;const x=fixture({chat:(_url,{signal})=>new Promise((_resolve,reject)=>{ready();signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true});})});await connect(x);const c=x.store.createConversation({agentId:'deepseek',type:'ai'});const pending=x.harness.send({conversationId:c.id,text:'取消也保留这一句'});await started;x.harness.cancel(c.id);await assert.rejects(pending,/取消/);assert.equal(cancelled,true);assert.equal(x.store.getMessages(c.id)[0].text,'取消也保留这一句');assert.equal(x.store.getMessages(c.id)[1].status,'cancelled');assert.equal(x.byok(),0);
});
test('managed malformed/truncated/tool replies are rejected; greeting context remains within 25-message contract',async()=>{
 for(const malformed of [{choices:[{index:0,message:{role:'assistant',content:'partial'},finish_reason:'length'}]},{choices:[{index:0,message:{role:'assistant',content:'ok',tool_calls:[]},finish_reason:'stop'}]},reply('  ')]){const x=fixture({chat:()=>new Response(JSON.stringify(malformed))});await connect(x);const c=x.store.createConversation({agentId:'deepseek',type:'ai'});await assert.rejects(x.harness.send({conversationId:c.id,text:'hello'}));assert.equal(x.store.getMessages(c.id)[1].status,'failed');}
 const x=fixture();await connect(x);const c=x.store.createConversation({agentId:'deepseek',type:'ai'});for(let n=0;n<30;n++)x.store.addMessage(c.id,{role:n%2?'assistant':'user',text:'history'+n,source:n%2?'ai':'user'});await x.harness.send({conversationId:c.id,greeting:true});const body=JSON.parse(x.requests.at(-1).input.body);assert.equal(body.messages.length,25);assert.equal(body.messages[0].role,'system');assert.match(body.messages.at(-1).content,/问候/);
});
test('managed usage is authenticated and arbitrary internal routes or injected endpoints cannot send',async()=>{
 const x=fixture();await connect(x);assert.equal((await x.managed.usage()).requestsRemaining,59);assert.equal(x.requests.at(-1).input.headers.Authorization,'Bearer '+TOKEN);assert.throws(()=>x.friends.managedRequest('../private'),/不支持/);const before=x.requests.length;await assert.rejects(x.managed.request({provider:{managed:true,consent:true,baseUrl:'https://evil.example/v1/managed',model:MODEL},messages:[],signal:new AbortController().signal}),/配置/);assert.equal(x.requests.length,before);
});

test('catalog accepts 50 models but rejects more than 128',async()=>{const models=Array.from({length:129},(_,i)=>({id:'deepseek-ai/model-'+i,name:'model '+i,vision:false}));assert.equal((await fixture({catalog:{...CATALOG,models:models.slice(0,50)}}).managed.catalog()).models.length,50);await assert.rejects(fixture({catalog:{...CATALOG,models}}).managed.catalog(),/列表/);});
