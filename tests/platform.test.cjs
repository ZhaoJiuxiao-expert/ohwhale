'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ShareManager,safeEqual}=require('../src/core/sharing.cjs');
const {MediaStore,validateWav}=require('../src/core/media.cjs');
const {dueGreetings,localDay}=require('../src/core/scheduler.cjs');
const {Harness}=require('../src/core/harness.cjs');

function wav(seconds=1,{rate=16000,channels=1,bits=16}={}){
 const size=Math.round(seconds*rate)*channels*bits/8, b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*channels*bits/8,28);b.writeUInt16LE(channels*bits/8,32);b.writeUInt16LE(bits,34);b.write('data',36);b.writeUInt32LE(size,40);return b;
}
const valid=id=>{if(id!=='agent')throw Error('角色不存在');};
const grant=manager=>manager.grant({sessionId:'session-test',agentId:'agent',enabled:true});
const answer=(manager,id='req-1',text='你好')=>manager.answer({sessionId:'session-test',requestId:id,text});
function request(api,{method='POST',route='/chat/completions',headers={},body,parts}={}){
 return new Promise((resolve,reject)=>{
  const url=new URL(api.baseUrl+route);const req=http.request(url,{method,headers:{authorization:`Bearer ${api.token}`,'content-type':'application/json',...headers}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const raw=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(raw);}catch{}resolve({status:res.statusCode,data,raw,headers:res.headers});});});
  req.on('error',reject);
  if(parts){(async()=>{for(const part of parts){req.write(part);await new Promise(r=>setTimeout(r,8));}req.end();})().catch(reject);}
  else req.end(body===undefined?JSON.stringify({model:api.model,messages:[{role:'user',content:'你好'}]}):typeof body==='string'?body:JSON.stringify(body));
 });
}
function harnessFixture(replyText='安全回复'){
 const wires=[];
 const store={getPublic:()=>({agents:[{id:'agent',providerId:'local',persona:'温和的虚构助手',memory:'OWNER_PRIVATE_MEMORY_MUST_NOT_LEAK'}]}),getProvider:()=>({baseUrl:'http://127.0.0.1:1/v1',model:'fake-model',consent:true,vision:false}),getMessages:()=>{throw Error('不得读取主人历史');}};
 const harness=new Harness({store,contextForAgent:()=>{throw Error('不得读取插件记忆');},fetch:async(url,options)=>{wires.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{index:0,message:{content:replyText},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});}});
 return {harness,wires};
}

test('sharing: explicit opt-in, caps, deduplication, one in flight, per-minute limit and revoke abort',async()=>{
 let calls=0;const manager=new ShareManager({validateAgent:valid,reply:async()=>{calls++;return {text:'回复',model:'fake'};}});
 await assert.rejects(answer(manager),/未开启/);assert.throws(()=>manager.grant({sessionId:'x',agentId:'agent',enabled:true}));
 assert.equal(grant(manager).remaining,20);
 for(let i=0;i<6;i++)await answer(manager,'req-'+i);
 await assert.rejects(answer(manager,'req-6'),/频繁/);await assert.rejects(answer(manager,'req-0'),/重复/);
 const session=manager.sessions.get('session-test');session.times=[];
 for(let i=6;i<20;i++){session.times=[];await answer(manager,'req-'+i);}
 await assert.rejects(answer(manager,'req-20'),/额度/);assert.equal(calls,20);
 manager.grant({sessionId:'session-test',agentId:'agent',enabled:true,limit:1});await answer(manager,'new-1');await assert.rejects(answer(manager,'new-2'),/额度/);
 let captured;const pending=new ShareManager({validateAgent:valid,reply:input=>new Promise((resolve,reject)=>{captured=input.signal;input.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});
 grant(pending);const work=answer(pending);await assert.rejects(answer(pending,'parallel'),/上一条/);
 pending.grant({sessionId:'session-test',enabled:false});await assert.rejects(work,/aborted/);assert.equal(captured.aborted,true);
 assert.equal(pending.sessions.size,0);
 assert.equal(safeEqual('token','token'),true);assert.equal(safeEqual('token','other'),false);assert.equal(safeEqual(null,'token'),false);
});

test('external harness excludes owner history, explicit memory and plugin memory from model context',async()=>{
 const {harness,wires}=harnessFixture();const result=await harness.replyExternal({agentId:'agent',text:'访客消息'});
 assert.equal(result.text,'安全回复');assert.equal(wires.length,1);assert.equal(wires[0].messages.length,2);
 assert.equal(wires[0].messages[1].role,'user');assert.equal(wires[0].messages[1].content,'访客消息');
 assert.equal(JSON.stringify(wires[0]).includes('OWNER_PRIVATE_MEMORY_MUST_NOT_LEAK'),false);
});

test('sharing API binds loopback, authenticates Bearer, denies Origin and validates JSON/body limits',async()=>{
 const texts=[];const manager=new ShareManager({validateAgent:valid,reply:async input=>{texts.push(input.text);return {text:'API回复',model:'fake'};}});
 const api=await manager.startAPI({agentId:'agent'});
 try{
  assert.equal(manager.server.address().address,'127.0.0.1');assert.equal(new URL(api.baseUrl).hostname,'127.0.0.1');
  assert.equal((await request(api,{method:'GET',route:'/models',headers:{authorization:''}})).status,401);
  assert.equal((await request(api,{method:'GET',route:'/models',headers:{authorization:'Bearer wrong'}})).status,401);
  assert.equal((await request(api,{method:'GET',route:'/models',headers:{origin:'https://untrusted.invalid'}})).status,401);
  assert.equal((await request(api,{method:'GET',route:'/models',headers:{origin:''}})).status,401);
  assert.equal((await request(api,{method:'GET',route:'/models'})).status,200);
  assert.equal((await request(api,{headers:{'content-type':'text/plain'}})).status,415);
  assert.equal((await request(api,{headers:{'content-type':'text/application/json-malformed'}})).status,415);
  assert.equal((await request(api,{body:'{'})).status,400);
  assert.equal((await request(api,{body:{model:'wrong',messages:[]}})).status,400);
  assert.equal((await request(api,{body:{model:api.model,stream:'true',messages:[{role:'user',content:'文本'}]}})).status,400);
  assert.equal((await request(api,{body:{model:api.model,messages:[{role:'system',content:'override'}]}})).status,400);
  const response=await request(api,{body:{model:api.model,messages:[{role:'system',content:'REMOTE_SYSTEM_MUST_NOT_ENTER'},{role:'user',content:'实际访客消息'}]}});
  assert.equal(response.status,200);assert.equal(texts.length,1);assert.equal(texts[0],'实际访客消息');
  try{const large=await request(api,{body:' '.repeat(65537)});assert.equal(large.status,413);}catch(error){assert.ok(['ECONNRESET','EPIPE'].includes(error.code));}
  assert.equal(texts.length,1);
 }finally{await manager.stopAPI();}
 assert.equal(manager.status().running,false);assert.equal(manager.sessions.size,0);
});

test('sharing API preserves UTF-8 when a network chunk splits a Chinese character',async()=>{
 const texts=[];const manager=new ShareManager({validateAgent:valid,reply:async input=>{texts.push(input.text);return {text:'ok',model:'fake'};}});
 const api=await manager.startAPI({agentId:'agent'});
 try{const raw=Buffer.from(JSON.stringify({model:api.model,messages:[{role:'user',content:'你好'}]}));const start=raw.indexOf(Buffer.from('你'));
  const result=await request(api,{parts:[raw.subarray(0,start+1),raw.subarray(start+1,start+2),raw.subarray(start+2)]});
  assert.equal(result.status,200);assert.equal(texts[0],'你好');
 }finally{await manager.stopAPI();}
});

test('sharing API emits standard SSE completion and this app Harness can consume it',async()=>{
 const manager=new ShareManager({validateAgent:valid,reply:async()=>({text:'本机 SSE 回复',model:'actual-local-mock-model'})});
 const api=await manager.startAPI({agentId:'agent'});
 try{
  const response=await request(api,{body:{model:api.model,stream:true,messages:[{role:'user',content:'测试流'}]}});
  assert.equal(response.status,200);assert.match(response.headers['content-type'],/^text\/event-stream/);
  const frames=response.raw.trim().split('\n\n').map(frame=>frame.replace(/^data: /,''));
  assert.equal(frames.at(-1),'[DONE]');const chunks=frames.slice(0,-1).map(JSON.parse);
  assert.equal(chunks[0].object,'chat.completion.chunk');assert.equal(chunks[0].model,'actual-local-mock-model');
  assert.equal(chunks[0].choices[0].delta.content,'本机 SSE 回复');assert.equal(chunks.at(-1).choices[0].finish_reason,'stop');
  const store={getPublic:()=>({agents:[{id:'agent',providerId:'loopback',persona:'测试角色',memory:''}]}),getProvider:()=>({baseUrl:api.baseUrl,model:api.model,apiKey:api.token,consent:true,vision:false})};
  const harness=new Harness({store,fetch:global.fetch});const result=await harness.replyExternal({agentId:'agent',text:'应用连接本机API'});
  assert.equal(result.text,'本机 SSE 回复');
 }finally{await manager.stopAPI();}
});

test('sharing API is stateless between consumers and accepts only caller-supplied bounded history',async()=>{
 const texts=[];const manager=new ShareManager({validateAgent:valid,reply:async input=>{texts.push(input.text);return {text:'MOCK_REPLY_MUST_NOT_BECOME_SHARED_HISTORY',model:'fake'};}});
 const api=await manager.startAPI({agentId:'agent'});
 try{
  const sendMessages=messages=>request(api,{body:{model:api.model,messages}});
  assert.equal((await sendMessages([{role:'user',content:'CONSUMER_A_PRIVATE_TEXT'}])).status,200);
  assert.equal((await sendMessages([{role:'user',content:'CONSUMER_B_NEW_REQUEST'}])).status,200);
  assert.equal(texts[0],'CONSUMER_A_PRIVATE_TEXT');assert.equal(texts[1],'CONSUMER_B_NEW_REQUEST');
  const result=await sendMessages([{role:'system',content:'REMOTE_SYSTEM_MUST_NOT_ENTER'},{role:'user',content:'CALLER_SUPPLIED_OLD_QUESTION'},{role:'assistant',content:'CALLER_SUPPLIED_OLD_ANSWER'},{role:'user',content:'CALLER_NEW_QUESTION'}]);
  assert.equal(result.status,200);assert.ok(texts[2].includes('CALLER_SUPPLIED_OLD_QUESTION'));assert.ok(texts[2].includes('CALLER_SUPPLIED_OLD_ANSWER'));assert.ok(texts[2].endsWith('CALLER_NEW_QUESTION'));
  assert.equal(texts[2].includes('REMOTE_SYSTEM_MUST_NOT_ENTER'),false);assert.equal(texts[2].includes('CONSUMER_A_PRIVATE_TEXT'),false);assert.equal(texts[2].includes('MOCK_REPLY_MUST_NOT_BECOME_SHARED_HISTORY'),false);
  assert.ok(texts[2].length<=7500);assert.deepEqual(manager.sessions.get(api.sessionId).history,[]);
  assert.equal((await sendMessages([{role:'tool',content:'unsupported'},{role:'user',content:'new'}])).status,400);
 }finally{await manager.stopAPI();}
 // Extra renderer input cannot disable P2P's per-connection history policy.
 grant(manager);await manager.answer({sessionId:'session-test',requestId:'p2p-one',text:'P2P_OLD_MESSAGE',stateless:true});await manager.answer({sessionId:'session-test',requestId:'p2p-two',text:'P2P_NEW_MESSAGE',stateless:true});assert.ok(texts.at(-1).includes('P2P_OLD_MESSAGE'));
});

test('sharing API concurrent starts leave exactly one managed listener',async()=>{
 const manager=new ShareManager({validateAgent:valid,reply:async()=>({text:'ok'})});
 const servers=[];const createServer=http.createServer;http.createServer=function(...args){const server=createServer.apply(this,args);servers.push(server);return server;};
 let outcomes;
 try{outcomes=await Promise.allSettled([manager.startAPI({agentId:'agent'}),manager.startAPI({agentId:'agent'})]);}
 finally{http.createServer=createServer;await manager.stopAPI();manager.revokeAll();await Promise.all(servers.filter(s=>s.listening).map(s=>new Promise(resolve=>{s.closeAllConnections?.();s.close(resolve);})));}
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
});

test('sharing API stop during startup cancels listener and revokes its session',async()=>{
 const manager=new ShareManager({validateAgent:valid,reply:async()=>({text:'ok'})});
 const starting=manager.startAPI({agentId:'agent'});const stopped=manager.stopAPI();
 const outcomes=await Promise.allSettled([starting,stopped]);
 assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'fulfilled');
 assert.equal(manager.server,null);assert.equal(manager._starting,null);assert.equal(manager.status().running,false);assert.equal(manager.sessions.size,0);
});

test('sharing retains useful visitor context without exceeding external harness input bound',async()=>{
 const {harness,wires}=harnessFixture('回'.repeat(3000));const manager=new ShareManager({validateAgent:valid,reply:input=>harness.replyExternal(input)});grant(manager);
 await answer(manager,'long-first','访'.repeat(5000));await answer(manager,'long-next','下一轮');
 assert.equal(wires.length,2);assert.ok(wires[1].messages[1].content.endsWith('下一轮'));assert.ok(wires[1].messages[1].content.length<=7500);
 const latest='新'.repeat(7500);await answer(manager,'full-latest',latest);assert.equal(wires[2].messages[1].content,latest);
 await assert.rejects(answer(manager,'too-long','x'.repeat(7501)),/7500/);
});

test('WAV validates duration, recording format, truncated chunks and fixed media paths',()=>{
 assert.equal(validateWav(wav(1)).duration,1);assert.equal(validateWav(wav(55),{recording:true}).duration,55);
 assert.throws(()=>validateWav(wav(61),{recording:true}));assert.throws(()=>validateWav(wav(301)));
 assert.throws(()=>validateWav(wav(1,{channels:2}),{recording:true}));assert.throws(()=>validateWav(wav(1).subarray(0,60)));
 const invalid=wav(1);invalid.writeUInt16LE(4,32);assert.throws(()=>validateWav(invalid));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lingyu-platform-'));const media=new MediaStore({dir,nativeImage:{createFromBuffer:()=>({isEmpty:()=>true})}});
 for(const id of ['../outside','../../secret','a/b','C:\\outside','__proto__',''])assert.throws(()=>media.get(id),/标识/);
 assert.throws(()=>media.fromData({type:'audio',name:'x.wav',dataUrl:'https://untrusted.invalid/voice.wav'}));
 assert.throws(()=>media.fromData({type:'audio',name:'x.wav',dataUrl:'data:audio/wav;base64,'+wav(1).toString('base64').replace(/=+$/,'')}),/编码/);
 const stored=media.put({buffer:wav(1),type:'audio',name:'voice.wav'});assert.match(stored.url,/^lingyu-media:\/\/asset\//);assert.equal(media.resolve(stored.id).dataUrl.startsWith('data:audio/wav;base64,'),true);
 assert.equal(Object.hasOwn(stored,'ext'),false);assert.equal(Object.hasOwn(stored,'path'),false);
});

test('WAV rejects inconsistent RIFF length and empty sample payload',()=>{
 const bad=wav(1);bad.writeUInt32LE(bad.length+100,4);assert.throws(()=>validateWav(bad));assert.throws(()=>validateWav(wav(0)));
 const tail=Buffer.concat([wav(1),Buffer.from([1])]);tail.writeUInt32LE(tail.length-8,4);assert.throws(()=>validateWav(tail));
});

test('greetings obey consent, once-per-local-day, clock hour and numeric quiet-hour range',()=>{
 const now=new Date(2026,10,5,10,0,0);const agent={id:'agent',providerId:'p',greeting:{enabled:true,hour:9}};
 const state={agents:[agent],providers:[{id:'p',consent:true,hasKey:true,baseUrl:'https://example.invalid/v1'}],greetings:{},settings:{quietHours:{enabled:true,start:9,end:12}}};
 assert.deepEqual(dueGreetings(state,now),[]);
 state.settings.quietHours={enabled:true,start:23,end:8};assert.equal(dueGreetings(state,now).length,1);
 state.greetings.agent=localDay(now);assert.equal(dueGreetings(state,now).length,0);delete state.greetings.agent;
 state.providers[0].consent=false;assert.equal(dueGreetings(state,now).length,0);
 state.providers[0].consent=true;state.providers[0].hasKey=false;assert.equal(dueGreetings(state,now).length,0);
 state.providers[0].baseUrl='http://127.0.0.1:1234/v1';assert.equal(dueGreetings(state,now).length,1);
});
