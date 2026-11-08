'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ProactiveService}=require('../src/core/proactive.cjs');
const {dueGreetings,localDay,jitterMinutes,proactiveEligibility,greetingPrompt,isDuplicateGreeting}=require('../src/core/scheduler.cjs');
const {ChatStore}=require('../src/core/store.cjs'),{Harness}=require('../src/core/harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x)),at=(day=8,hour=12,minute=0)=>new Date(2026,10,day,hour,minute),plus=(date,minutes)=>new Date(date.getTime()+minutes*60000);
function fixture({mode='daily',reply='我刚想到一个小问题：如果云也有口袋，会不会把雨藏在里面？',state:saved,dir}={}){
 const state=saved||{agents:[{id:'fish',name:'小鲸',persona:'温暖机灵',memory:'',providerId:'managed',greeting:{enabled:true,hour:9,mode}}],providers:[{id:'managed',managed:true,consent:true,hasKey:false,baseUrl:'https://managed.invalid/v1',model:'domestic-fixture'}],conversations:[{id:'chat',type:'ai',agentId:'fish',archived:false,updatedAt:at(7).toISOString()}],messages:{chat:[]},greetings:{},settings:{}};
 const store={getPublic:()=>clone(state),getConversation:id=>clone(state.conversations.find(c=>c.id===id)||null),getMessages:id=>clone(state.messages[id]),createConversation({agentId}){const c={id:'new-chat',type:'ai',agentId,archived:false};state.conversations.push(c);state.messages[c.id]=[];return c;},addMessage(cid,m){if(state.messages[cid].some(x=>x.id===m.id))throw Error('duplicate');state.messages[cid].push(clone(m));return clone(m);},markGreeting(id,day){state.greetings[id]=day;}};
 const calls=[],notifications=[],changes=[],pluginState={settings:{proactive:true}};let clockValue=at();
 const harness={active:new Map(),async generateGreeting(input){calls.push(input);if(reply instanceof Error)throw reply;if(typeof reply==='function')return reply(input);return {text:reply,model:'domestic-fixture'};}};
 const options={dir:dir||fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-proactive-')),store,harness,plugins:{getPublic:()=>clone(pluginState)},clock:()=>clockValue,onNotify:e=>notifications.push(e),onChange:e=>changes.push(e)};
 const service=new ProactiveService(options);
 const add=(role,text,date=at(7),greeting=false)=>state.messages.chat.push({id:'old-'+state.messages.chat.length,role,text,createdAt:date.toISOString(),status:'sent',greeting,attachments:[]});
 return {state,store,harness,calls,notifications,changes,pluginState,options,service,add,setClock:d=>{clockValue=d;}};
}

test('managed/no-key provider is eligible; local quiet default is 23–8 and daily catches up only today',()=>{
 const x=fixture();assert.equal(dueGreetings(x.state,at()).length,1);assert.equal(dueGreetings(x.state,at(8,7)).length,0);assert.equal(dueGreetings(x.state,at(8,22)).length,1);assert.equal(dueGreetings(x.state,at(8,23)).length,0);
 x.state.greetings.fish=localDay(at(7));assert.equal(dueGreetings(x.state,at(8,13)).length,1);x.state.greetings.fish=localDay(at());assert.equal(dueGreetings(x.state,at()).length,0);
 delete x.state.greetings.fish;x.state.providers[0].consent=false;assert.equal(dueGreetings(x.state,at()).length,0);
});
test('natural jitter is stable, bounded, and interaction cooldown expires at ninety minutes',()=>{
 const x=fixture({mode:'natural'}),day=localDay(at()),jitter=jitterMinutes('fish',day);assert.equal(jitter,jitterMinutes('fish',day));assert(jitter>=0&&jitter<=60);
 assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,8,59)).due,false);
 x.add('user','稍后再说',at(8,11));assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,12,29)).reason,'interaction-cooldown');assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,12,30)).due,true);
});
test('daily schedules also leave ninety minutes after a normal chat response',()=>{
 const x=fixture();x.add('user','想和你聊聊',at(8,10,59));x.add('assistant','我在听呀',at(8,11));assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,12,29)).reason,'interaction-cooldown');assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,12,30)).due,true);
});
test('natural mode pauses after seven days without a user message until the user comes back',()=>{
 const x=fixture({mode:'natural'});x.add('user','上次聊天',at(1,12));assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,12)).due,true);assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,12,1)).reason,'waiting-for-you');
 x.add('user','我回来啦',at(8,13));assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,14)).reason,'interaction-cooldown');assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,14,30)).due,true);
});
test('two unanswered greetings impose a forty-eight-hour cooldown; a real reply resets it',()=>{
 const x=fixture();x.add('assistant','第一条',at(6,12),true);x.add('assistant','第二条',at(7,12),true);
 assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,12)).reason,'unanswered-cooldown');assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(9,12)).due,true);
 x.add('user','谢谢，我看到啦',at(8,10));assert.equal(proactiveEligibility(x.state,x.state.agents[0],at(8,12)).due,true);
});
test('archived-only chats stay archived and never spend an API request',async()=>{
 const x=fixture();x.state.conversations[0].archived=true;assert.equal(proactiveEligibility(x.state,x.state.agents[0],at()).reason,'all-conversations-archived');await x.service.tick(at());assert.equal(x.calls.length,0);assert.equal(x.state.conversations.length,1);
});
test('successful generation creates one real bubble then marks success; restart cannot double bill',async()=>{
 const x=fixture(),before=x.state.messages.chat.length;const result=await x.service.tick(at());assert.equal(result.outcomes[0].status,'sent');assert.equal(x.calls.length,1);assert.equal(x.state.messages.chat.length,before+1);assert.equal(x.state.messages.chat[0].greeting,true);assert.equal(x.state.greetings.fish,localDay(at()));assert.equal(x.notifications.length,1);assert.equal(x.changes.length,1);
 await x.service.tick(plus(at(),1));const restarted=new ProactiveService(x.options);await restarted.tick(plus(at(),2));assert.equal(x.calls.length,1);assert.equal(restarted.status(at()).agents[0].status,'sent');assert.equal(restarted.status(at()).supported,true);
});
test('failed calls back off 15/30/60 minutes, cap at three per day, and never mark success',async()=>{
 const x=fixture({reply:Object.assign(Error('offline'),{code:'NETWORK'})});await x.service.tick(at());assert.equal(x.state.greetings.fish,undefined);assert.equal(x.state.messages.chat.length,0);
 await x.service.tick(plus(at(),14));assert.equal(x.calls.length,1);
 const restarted=new ProactiveService(x.options);await restarted.tick(plus(at(),15));assert.equal(x.calls.length,2);await restarted.tick(plus(at(),44));assert.equal(x.calls.length,2);await restarted.tick(plus(at(),45));assert.equal(x.calls.length,3);await restarted.tick(plus(at(),120));assert.equal(x.calls.length,3);assert.equal(x.notifications.length,0);assert.equal(restarted.status(at()).agents[0].attempts,3);
 await restarted.tick(at(9,12));assert.equal(x.calls.length,4);
});
test('HTTP 429 imposes at least thirty minutes before a retry, including after restart',async()=>{
 const x=fixture({reply:Object.assign(Error('HTTP 429'),{code:'HTTP',status:429})});await x.service.tick(at());const restarted=new ProactiveService(x.options);await restarted.tick(plus(at(),29));assert.equal(x.calls.length,1);await restarted.tick(plus(at(),30));assert.equal(x.calls.length,2);
});
test('persisted in-flight attempt is billed conservatively once and waits after restart',async()=>{
 const x=fixture();x.service.record({agentId:'fish',day:localDay(at()),status:'attempt',attempts:1,at:at().toISOString(),nextAttemptAt:plus(at(),30).toISOString()});const restarted=new ProactiveService(x.options);await restarted.tick(plus(at(),1));assert.equal(x.calls.length,0);await restarted.tick(plus(at(),30));assert.equal(x.calls.length,1);assert.equal(restarted.status(at()).agents[0].attempts,2);
});
test('literal and conservative semantic duplicate templates are suppressed before any chat bubble',async()=>{
 assert(isDuplicateGreeting('早安！记得喝水，忙的话不用回复。',['早上好～别忘了补水，有空再回就好。']));assert(!isDuplicateGreeting('今天想聊聊你上次提到的素数问题。',['早安，记得喝水，不用急着回。']));
 const x=fixture({reply:'早安！记得喝水，忙的话不用回复。'});x.add('assistant','早上好～别忘了补水，有空再回就好。',at(7,12),true);const before=x.state.messages.chat.length;const result=await x.service.tick(at());assert.equal(result.outcomes[0].reason,'duplicate');assert.equal(x.state.messages.chat.length,before);assert.equal(x.state.greetings.fish,undefined);const restarted=new ProactiveService(x.options);await restarted.tick(plus(at(),90));assert.equal(x.calls.length,1);assert.equal(x.notifications.length,0);
});
test('oversized proactive output is suppressed for the day without leaving a chat bubble',async()=>{
 const x=fixture({reply:'长'.repeat(601)});const result=await x.service.tick(at());assert.equal(result.outcomes[0].reason,'invalid-length');assert.equal(x.state.messages.chat.length,0);assert.equal(x.state.greetings.fish,undefined);await new ProactiveService(x.options).tick(plus(at(),60));assert.equal(x.calls.length,1);
});
test('switching model, disabling the character, archiving or disabling plugin while generating prevents delivery',async()=>{
 for(const mutate of [x=>{x.state.providers[0].model='changed';},x=>{x.state.agents[0].greeting.enabled=false;},x=>{x.state.conversations[0].archived=true;},x=>{x.pluginState.settings.proactive=false;}]){
  let resolve;const x=fixture({reply:()=>new Promise(r=>{resolve=r;})});const task=x.service.tick(at());await Promise.resolve();mutate(x);resolve({text:'这是一条完整但授权已经改变的回复',model:'domestic-fixture'});const result=await task;assert.equal(result.outcomes[0].status,'suppressed');assert.equal(x.state.messages.chat.length,0);assert.equal(x.state.greetings.fish,undefined);
 }
});
test('a reply finishing after midnight is not delivered as yesterday or rescheduled with another bill',async()=>{
 let resolve;const x=fixture({reply:()=>new Promise(r=>{resolve=r;})});x.state.settings.quietHours={enabled:false,start:23,end:8};x.setClock(at(8,23,59));const task=x.service.tick(at(8,23,59));await Promise.resolve();x.setClock(at(9,0,1));resolve({text:'越过午夜的问候',model:'domestic-fixture'});const result=await task;assert.equal(result.outcomes[0].status,'suppressed');assert.equal(x.state.messages.chat.length,0);assert.equal(x.state.greetings.fish,undefined);
});
test('a generated reply entering quiet hours waits without another call and does not block future-day eligibility',async()=>{
 let resolve;const x=fixture({reply:()=>new Promise(r=>{resolve=r;})});x.setClock(at(8,22,59));const task=x.service.tick(at(8,22,59));await Promise.resolve();x.setClock(at(8,23,1));resolve({text:'安静时段之前准备好的消息',model:'domestic-fixture'});assert.equal((await task).outcomes[0].status,'deferred');assert.equal(x.calls.length,1);assert.equal(x.state.messages.chat.length,0);
 await x.service.tick(at(8,23,30));assert.equal(x.calls.length,1);const restarted=new ProactiveService(x.options);assert.equal((await restarted.tick(at(9,8))).outcomes[0].status,'suppressed');assert.equal(x.calls.length,1);assert.equal(x.state.messages.chat.length,0);assert.equal(restarted.preview(at(9,12))[0].due,true);
});
test('prepared replies recover a failed ChatStore write without generating again',async()=>{
 const x=fixture(),original=x.store.addMessage;let fail=true;x.store.addMessage=(...args)=>{if(fail)throw Error('disk full');return original(...args);};const result=await x.service.tick(at());assert.equal(result.outcomes[0].reason,'delivery-pending');assert.equal(x.calls.length,1);assert.equal(x.state.greetings.fish,undefined);fail=false;
 const restarted=new ProactiveService(x.options);await restarted.tick(plus(at(),1));assert.equal(x.calls.length,1);assert.equal(x.state.messages.chat.length,1);assert.equal(x.state.greetings.fish,localDay(at()));
});
test('a persisted reply whose markGreeting failed is recovered by message ID without duplication',async()=>{
 const x=fixture(),mark=x.store.markGreeting;let fail=true;x.store.markGreeting=(...args)=>{if(fail)throw Error('disk full');return mark(...args);};await x.service.tick(at());assert.equal(x.state.messages.chat.length,1);assert.equal(x.state.greetings.fish,undefined);fail=false;await new ProactiveService(x.options).tick(plus(at(),1));assert.equal(x.calls.length,1);assert.equal(x.state.messages.chat.length,1);assert.equal(x.state.greetings.fish,localDay(at()));
});
test('concurrent ticks and dispose cannot produce a sent message',async()=>{
 let resolve;const x=fixture({reply:()=>new Promise(r=>{resolve=r;})});const task=x.service.tick(at());assert.equal((await x.service.tick(at())).busy,true);x.service.dispose();resolve({text:'取消后不应展示',model:'domestic-fixture'});await task;assert.equal(x.calls.length,1);assert.equal(x.state.messages.chat.length,0);assert.equal(x.state.greetings.fish,undefined);await x.service.tick(plus(at(),30));assert.equal(x.calls.length,1);
});
test('ledger disk failure occurs before a paid request and leaves all original messages intact',async()=>{
 const x=fixture(),write=fs.writeFileSync;fs.writeFileSync=function(file,...args){if(typeof file==='number')throw Error('DISK_FULL_FIXTURE');return write.call(this,file,...args);};try{await assert.rejects(x.service.tick(at()),/DISK_FULL/);}finally{fs.writeFileSync=write;}
 assert.equal(x.calls.length,0);assert.equal(x.state.messages.chat.length,0);assert.equal(x.state.greetings.fish,undefined);
});
test('prompt treats previous text as untrusted, avoids invented current state and pressure',()=>{
 const prompt=greetingPrompt({mode:'natural',day:localDay(at()),previousTexts:['old greeting']});assert.match(prompt,/不可信参考/);assert.match(prompt,/不编造/);assert.match(prompt,/不施压/);assert.match(prompt,/未结束的话题/);
});
test('Harness generates privately from persona, confirmed memory and text-only history, with no bubbles or deltas',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-proactive-harness-')),store=new ChatStore({dir,encrypt:x=>'encrypted:'+x,decrypt:x=>x.slice(10)}),events=[],calls=[];
 store.saveProvider({id:'atlas',consent:true,apiKey:'FAKE_PROACTIVE_TEST',vision:false});store.saveAgent({id:'deepseek',memory:'USER_CONFIRMED_NOTE',persona:'PERSONA_FIXTURE'});const c=store.createConversation({agentId:'deepseek'});
 store.addMessage(c.id,{role:'user',text:'照片旁边的文字',attachments:[{id:'fixture-photo',type:'image',mime:'image/png',name:'photo',url:'lingyu-media://asset/fixture-photo',bytes:8}]});
 const harness=new Harness({store,onEvent:e=>events.push(e),contextForAgent:()=>'CONFIRMED_PLUGIN_NOTE',resolveImage:()=>{throw Error('Historic image must not be opened');},fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:'可以接着聊上次的话题呀。'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});}});
 const result=await harness.generateGreeting({conversationId:c.id,greetingContext:greetingPrompt({mode:'natural'})});assert.equal(result.text,'可以接着聊上次的话题呀。');assert.equal(store.getMessages(c.id).length,1);assert.equal(events.length,0);assert(calls[0].messages[0].content.includes('USER_CONFIRMED_NOTE'));assert(calls[0].messages[0].content.includes('CONFIRMED_PLUGIN_NOTE'));assert(calls[0].messages[0].content.includes('PERSONA_FIXTURE'));assert(calls[0].messages.every(m=>typeof m.content==='string'));assert.equal(calls[0].messages[1].content,'照片旁边的文字');assert.equal(calls[0].max_tokens,512);
});
