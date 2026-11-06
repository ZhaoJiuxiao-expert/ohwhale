'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createSignalingServer}=require('../server/signaling.cjs');
const {ALPHABET}=require('../server/friends.cjs');
const fresh=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-friends-server-'));
async function fixture(options={}){let base;const dir=options.friendsDir??fresh(),ownerToken=crypto.randomBytes(32).toString('base64url');const app=createSignalingServer({ownerToken,turnSecret:crypto.randomBytes(32).toString('base64url'),publicUrl:()=>base,friendsDir:dir,...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;return {...app,dir,base,ownerToken,req:async(action,{token,body,method=body===undefined?'GET':'POST',raw,headers={}}={})=>{const res=await fetch(base+(action.startsWith('/')?action:'/v1/friends/'+action),{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined||raw!==undefined?{body:raw??JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};}};}
const register=async(app,name)=>{const result=await app.req('register',{body:{name}});assert.equal(result.status,200);return result.data;};
const state=async(app,user)=>{const result=await app.req('state',{token:user.token});assert.equal(result.status,200);return result.data;};
async function friends(app,a,b){assert.equal((await app.req('request',{token:a.token,body:{code:b.self.code}})).status,200);const request=(await state(app,b)).requests.incoming.find(r=>r.from.id===a.self.id);assert.equal((await app.req('respond',{token:b.token,body:{requestId:request.id,accept:true}})).status,200);}
const snapshots=dir=>fs.readdirSync(dir).filter(n=>n.startsWith('snapshot-')).sort();
test('friends remain closed without explicit data directory; origin, auth, JSON and schema boundaries are strict',async()=>{
 const disabled=await fixture({friendsDir:undefined});try{assert.equal((await disabled.req('register',{body:{name:'A'}})).data.error.code,'FRIENDS_DISABLED');}finally{await disabled.close();}
 const app=await fixture({friendsLimits:{registerPerMinute:20}});try{
  assert.equal((await app.req('register',{body:{name:'A'},headers:{Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await app.req('state')).status,401);
  assert.equal((await app.req('register',{method:'POST',raw:'{"name":"A","__proto__":{}}'})).status,400);
  for(const name of ['../bad','a/b','a\\b','a:b','bad\nname',' '.repeat(2),'a'.repeat(61)])assert.equal((await app.req('register',{body:{name}})).status,400);
  const tooBig=await app.req('register',{method:'POST',raw:' '.repeat(4097)});assert.equal(tooBig.status,413);
  assert.equal(fs.readdirSync(app.dir).length,0);
 }finally{await app.close();}
});
test('mutual approval survives restart, crossing requests never auto-approve, and credentials never enter graph/public state',async()=>{
 let app=await fixture();const dir=app.dir;let a,b;try{
  a=await register(app,'Alice');b=await register(app,'Bob');const outsider=await register(app,'Observer');assert.equal(ALPHABET.length,32);assert.match(a.self.code,/^JW-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);assert.equal(a.token.length,43);
  await app.req('request',{token:a.token,body:{code:b.self.code}});const count=snapshots(dir).length;await app.req('request',{token:a.token,body:{code:b.self.code}});assert.equal(snapshots(dir).length,count);
  await app.req('request',{token:b.token,body:{code:a.self.code}});const bs=await state(app,b),as=await state(app,a);assert.equal(bs.contacts.length,0);assert.equal(as.requests.incoming.length,1);assert.equal(bs.requests.incoming.length,1);assert.equal((await state(app,outsider)).requests.incoming.length,0);
  const request=bs.requests.incoming[0];assert.equal((await app.req('respond',{token:a.token,body:{requestId:request.id,accept:true}})).status,403);assert.equal((await app.req('respond',{token:outsider.token,body:{requestId:request.id,accept:true}})).status,403);
  await app.req('respond',{token:b.token,body:{requestId:request.id,accept:true}});const approved=await state(app,a);assert.equal(approved.contacts[0].id,b.self.id);assert.deepEqual(approved.requests,{incoming:[],outgoing:[]});assert.equal(JSON.stringify(approved).includes('token'),false);
  const disk=snapshots(dir).map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('');for(const raw of [a.token,b.token,outsider.token,app.ownerToken])assert.equal(disk.includes(raw),false);assert.ok(disk.includes(crypto.createHash('sha256').update(a.token).digest('hex')));
  await app.close();app=await fixture({friendsDir:dir});const recovered=await state(app,a);assert.deepEqual(recovered.self,a.self);assert.equal(recovered.contacts[0].id,b.self.id);assert.equal(recovered.contacts[0].online,false);assert.deepEqual(recovered.calls,[]);
 }finally{await app.close();}
});
test('accepted live calls grant only participants paired independent capabilities; end/block/expiry revoke signaling, not graph',async()=>{
 let time=Date.now();const app=await fixture({now:()=>time});try{
  const a=await register(app,'Alice'),b=await register(app,'Bob'),other=await register(app,'Observer');await friends(app,a,b);await state(app,a);await state(app,b);
  const call=(await app.req('call',{token:a.token,body:{friendId:b.self.id}})).data.callId;assert.ok(call);assert.equal((await app.req('call',{token:b.token,body:{friendId:a.self.id}})).data.error.code,'BUSY');assert.equal((await app.req('session',{token:a.token,body:{callId:call}})).status,409);assert.equal((await app.req('respond-call',{token:a.token,body:{callId:call,accept:true}})).status,403);assert.equal((await app.req('session',{token:other.token,body:{callId:call}})).status,404);
  assert.equal((await app.req('respond-call',{token:b.token,body:{callId:call,accept:true}})).status,200);
  const host=(await app.req('session',{token:a.token,body:{callId:call}})).data,guest=(await app.req('session',{token:b.token,body:{callId:call}})).data;
  assert.equal(host.host,true);assert.equal(guest.host,false);assert.equal(host.peer.id,b.self.id);assert.equal(host.room.mode,'human');assert.equal(host.room.policy,'all');assert.equal(host.room.roomId,guest.room.roomId);assert.notEqual(host.room.token,guest.room.token);assert.deepEqual((await app.req('session',{token:a.token,body:{callId:call}})).data,host);
  const route='/v1/rooms/'+host.room.roomId;assert.equal((await app.req(route+'/signal',{token:guest.room.token})).data.state,'paired');assert.equal((await app.req(route+'/signal',{token:a.token})).status,404);assert.equal((await app.req(route+'/signal',{token:guest.room.token,body:{type:'offer',code:'LY1.abc'}})).status,400);assert.equal((await app.req(route+'/signal',{token:host.room.token,body:{type:'offer',code:'LY1.abc'}})).status,200);assert.equal((await app.req(route+'/signal',{token:guest.room.token})).data.signal.code,'LY1.abc');
  const listing=JSON.stringify(await state(app,a));for(const raw of [host.room.token,guest.room.token,'iceServers','credential'])assert.equal(listing.includes(raw),false);const persisted=snapshots(app.dir).map(n=>fs.readFileSync(path.join(app.dir,n),'utf8')).join('');assert.equal(persisted.includes(host.room.token),false);
  await app.req('end-call',{token:b.token,body:{callId:call}});assert.equal(app.stats().rooms,0);assert.equal((await state(app,a)).contacts.length,1);
  const next=(await app.req('call',{token:a.token,body:{friendId:b.self.id}})).data.callId;await app.req('respond-call',{token:b.token,body:{callId:next,accept:true}});time+=120001;assert.equal((await app.req('session',{token:a.token,body:{callId:next}})).status,404);assert.equal(app.stats().rooms,0);assert.equal((await state(app,a)).contacts.length,1);assert.equal((await app.req('call',{token:a.token,body:{friendId:b.self.id}})).data.error.code,'OFFLINE');
  await state(app,b);const last=(await app.req('call',{token:a.token,body:{friendId:b.self.id}})).data.callId;await app.req('respond-call',{token:b.token,body:{callId:last,accept:true}});await app.req('block',{token:b.token,body:{friendId:a.self.id}});assert.equal(app.stats().rooms,0);assert.equal((await state(app,a)).contacts.length,0);assert.equal((await app.req('request',{token:a.token,body:{code:b.self.code}})).status,404);
 }finally{await app.close();}
});
test('concurrent registrations and room accepts cannot exceed quotas; registration daily IP budget persists across restart',async()=>{
 let app=await fixture({friendsLimits:{maxIdentities:2,registerPerMinute:20,registerPerDay:2}});const dir=app.dir;try{
  const results=await Promise.all(Array.from({length:8},(_,i)=>app.req('register',{body:{name:'User'+i}})));assert.equal(results.filter(r=>r.status===200).length,2);assert.equal(snapshots(dir).length,2);await app.close();app=await fixture({friendsDir:dir,friendsLimits:{maxIdentities:10,registerPerMinute:20,registerPerDay:2}});assert.equal((await app.req('register',{body:{name:'Later'}})).status,429);
 }finally{await app.close();}
 const rooms=await fixture({maxRooms:1});try{
  const a=await register(rooms,'Alice'),b=await register(rooms,'Bob');await friends(rooms,a,b);await state(rooms,b);
  const existing=(await rooms.req('/v1/rooms',{token:rooms.ownerToken,body:{mode:'human',policy:'all'}})).data;const call=(await rooms.req('call',{token:a.token,body:{friendId:b.self.id}})).data.callId;
  assert.equal((await rooms.req('respond-call',{token:b.token,body:{callId:call,accept:true}})).status,429);assert.equal((await state(rooms,b)).calls[0].status,'ringing');await rooms.req('/v1/rooms/'+existing.roomId,{token:existing.token,method:'DELETE'});assert.equal((await rooms.req('respond-call',{token:b.token,body:{callId:call,accept:true}})).status,200);assert.equal(rooms.stats().rooms,1);
 }finally{await rooms.close();}
});
test('latest snapshot corruption fails closed without fallback/deletion; failed exclusive append never changes memory or overwrites disk',async()=>{
 const app=await fixture();let user;try{user=await register(app,'Alice');}finally{await app.close();}
 const first=snapshots(app.dir)[0],original=fs.readFileSync(path.join(app.dir,first));fs.writeFileSync(path.join(app.dir,'snapshot-000000000002.json'),'{bad',{flag:'wx',mode:0o600});assert.throws(()=>createSignalingServer({ownerToken:crypto.randomBytes(32).toString('base64url'),turnSecret:crypto.randomBytes(32).toString('base64url'),publicUrl:'https://example.invalid',friendsDir:app.dir}),/corrupt/);assert.deepEqual(fs.readFileSync(path.join(app.dir,first)),original);assert.equal(snapshots(app.dir).length,2);
 const live=await fixture();try{const a=await register(live,'A'),b=await register(live,'B');fs.writeFileSync(path.join(live.dir,'snapshot-000000000003.json'),'preserve-conflict',{flag:'wx',mode:0o600});const response=await live.req('request',{token:a.token,body:{code:b.self.code}});assert.equal(response.status,503);assert.equal((await state(live,a)).requests.outgoing.length,0);assert.equal(fs.readFileSync(path.join(live.dir,'snapshot-000000000003.json'),'utf8'),'preserve-conflict');}finally{await live.close();}
});
test('persisted two-device approval creates real native RTC through participant-scoped paired room capabilities', {timeout:45000},async()=>{
 const playwright=require('playwright');let app=await fixture(),browser;const dir=app.dir;
 try{
  const a=await register(app,'NativeA'),b=await register(app,'NativeB');await friends(app,a,b);await app.close();app=await fixture({friendsDir:dir});await state(app,a);await state(app,b);
  const callId=(await app.req('call',{token:a.token,body:{friendId:b.self.id}})).data.callId;await app.req('respond-call',{token:b.token,body:{callId,accept:true}});const grants=await Promise.all([a,b].map(async user=>(await app.req('session',{token:user.token,body:{callId}})).data));
  browser=await playwright.chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const contexts=await Promise.all([browser.newContext(),browser.newContext()]),pages=await Promise.all(contexts.map(c=>c.newPage()));await Promise.all(pages.map(p=>p.goto(app.base+'/check')));
  await Promise.all(pages.map((page,i)=>page.evaluate(async grant=>{const {PeerLink}=await import('/client/peer.js');window.messages=[];window.peer=new PeerLink({iceServers:grant.room.iceServers,onMessage:value=>messages.push(value)});},grants[i])));
  const offer=await pages[0].evaluate(()=>peer.createOffer({name:'NativeA',mode:'human'})),route='/v1/rooms/'+grants[0].room.roomId;assert.equal((await app.req(route+'/signal',{token:grants[0].room.token,body:{type:'offer',code:offer}})).status,200);
  const receivedOffer=(await app.req(route+'/signal',{token:grants[1].room.token})).data.signal.code,answer=await pages[1].evaluate(code=>peer.acceptOffer(code,{name:'NativeB'}),receivedOffer);await app.req(route+'/signal',{token:grants[1].room.token,body:{type:'answer',code:answer}});const receivedAnswer=(await app.req(route+'/signal',{token:grants[0].room.token})).data.signal.code;await pages[0].evaluate(code=>peer.acceptAnswer(code),receivedAnswer);
  await Promise.all(pages.map(page=>page.waitForFunction(()=>peer.info.connected)));await pages[0].evaluate(()=>peer.send({type:'chat',id:'friend-native-message',text:'friend-native-local-verification'}));await pages[1].waitForFunction(()=>messages.length===1);assert.equal(await pages[1].evaluate(()=>messages[0].text),'friend-native-local-verification');assert.equal((await pages[0].evaluate(()=>peer.diagnostics())).route,'direct');
  await app.req('end-call',{token:a.token,body:{callId}});assert.equal(app.stats().rooms,0);assert.equal((await state(app,a)).contacts.length,1);await Promise.all(pages.map(page=>page.evaluate(()=>peer.close())));
 }finally{if(browser)await browser.close();await app.close();}
});

test('internal authentication returns only an immutable public principal and shares a bounded raw-IP auth budget',async()=>{
 const app=await fixture();try{const user=await register(app,'Principal');const principal=app.friends.authenticate(user.token,'127.0.0.1');assert.deepEqual(principal,user.self);assert.equal(Object.isFrozen(principal),true);assert.equal('tokenHash' in principal,false);assert.equal('registrationIp' in principal,false);for(let i=0;i<30;i++)assert.throws(()=>app.friends.authenticate('bad','192.0.2.1'),e=>e.status===401);assert.throws(()=>app.friends.authenticate('bad','192.0.2.1'),e=>e.status===429);assert.deepEqual(app.friends.authenticate(user.token,'192.0.2.1'),user.self);assert.equal([...app.friends.rates.keys()].some(key=>key.includes('192.0.2.1')),false);}finally{await app.close();}
});
