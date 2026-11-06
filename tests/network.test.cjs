'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createSignalingServer,originURL}=require('../server/signaling.cjs');
const OWNER=crypto.randomBytes(32).toString('base64url'),SECRET=crypto.randomBytes(32).toString('base64url');
async function fixture(options={}){let base;const app=createSignalingServer({ownerToken:OWNER,turnSecret:SECRET,publicUrl:()=>base,...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;return {...app,base,request:async(route,{method='GET',token,body,headers={}}={})=>{const response=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json(),headers:response.headers};}};}
const create=app=>app.request('/v1/rooms',{method:'POST',token:OWNER,body:{mode:'human',policy:'all'}});
test('deployment generator preserves existing files, keeps secrets private and prepares restricted coturn config',()=>{
 const os=require('node:os'),{spawnSync}=require('node:child_process');const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-network-config-')),script=path.join(__dirname,'../server/deploy/configure.cjs');
 const options={cwd,env:{...process.env,OH_SIGNAL_DOMAIN:'signal.example.invalid',OH_TURN_DOMAIN:'turn.example.invalid',OH_PUBLIC_IP:'203.0.113.10',OH_PRIVATE_IP:'10.0.0.2'},encoding:'utf8'};
 const first=spawnSync(process.execPath,[script],options);assert.equal(first.status,0);const raw=fs.readFileSync(path.join(cwd,'secrets.env'),'utf8'),token=/SIGNAL_OWNER_TOKEN=(.+)/.exec(raw)[1],secret=/TURN_SHARED_SECRET=(.+)/.exec(raw)[1];assert.equal(first.stdout.includes(token),false);assert.equal(first.stdout.includes(secret),false);
 const config=fs.readFileSync(path.join(cwd,'turnserver.conf'),'utf8');for(const value of ['use-auth-secret','user-quota=4','total-quota=40','no-tcp-relay','denied-peer-ip=100.64.0.0','external-ip=203.0.113.10/10.0.0.2'])assert.ok(config.includes(value));assert.ok(config.includes(secret));assert.ok(raw.includes('stun:turn.example.invalid:3478'));
 const second=spawnSync(process.execPath,[script],options);assert.notEqual(second.status,0);assert.equal(fs.readFileSync(path.join(cwd,'secrets.env'),'utf8'),raw);
});
test('signaling validates endpoint and secrets, owner access, Origin and capability-scoped room roles',async()=>{
 for(const url of ['http://public.example','https://user:pass@example.com','https://example.com/path','https://example.com/?x=1','https://example.com/#x'])assert.throws(()=>originURL(url));
 assert.throws(()=>createSignalingServer({ownerToken:'short',turnSecret:SECRET,publicUrl:'https://example.com'}));
 const app=await fixture();try{
  assert.equal((await app.request('/v1/rooms',{method:'POST',body:{mode:'human',policy:'all'}})).status,401);
  assert.equal((await app.request('/health',{headers:{Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await app.request('/v1/rooms',{method:'POST',token:OWNER,body:{mode:'human',policy:'relay'}})).status,503);
  const room=(await create(app)).data,invite=JSON.parse(Buffer.from(room.code.slice(4),'base64url'));assert.equal(invite.u,app.base);assert.equal(room.code.includes(room.token),false);assert.equal(room.code.includes(OWNER),false);
  const route='/v1/rooms/'+room.roomId;assert.equal((await app.request(route+'/signal')).status,404);
  assert.equal((await app.request(route+'/join',{method:'POST',body:{secret:'x'.repeat(43)}})).status,404);
  const guest=(await app.request(route+'/join',{method:'POST',body:{secret:invite.k}})).data;
  assert.equal((await app.request(route+'/join',{method:'POST',body:{secret:invite.k}})).status,404);
  assert.equal((await app.request(route+'/signal',{method:'POST',token:guest.token,body:{type:'offer',code:'LY1.abc'}})).status,400);
  assert.equal((await app.request(route+'/signal',{method:'POST',token:room.token,body:{type:'offer',code:'LY1.abc'}})).status,200);
  assert.equal((await app.request(route+'/signal',{token:guest.token})).data.signal.code,'LY1.abc');
  assert.equal((await app.request(route+'/signal',{method:'POST',token:guest.token,body:{type:'answer',code:'LY1.def'}})).status,200);
  assert.equal((await app.request(route+'/signal',{token:room.token})).data.signal.code,'LY1.def');
  await app.request(route+'/ready',{method:'POST',token:room.token});await app.request(route+'/ready',{method:'POST',token:guest.token});assert.equal(app.stats().rooms,0);
 }finally{await app.close();}
});
test('short-lived TURN REST credentials use server secret; expiry, deletion, rate and body caps are enforced',async()=>{
 let now=Date.now();const app=await fixture({now:()=>now,roomTTL:1000,turnTTL:1000,turnUrls:['turn:turn.example.invalid:3478?transport=udp']});try{
  const room=(await create(app)).data,credentials=room.iceServers[0];assert.equal(credentials.credential,crypto.createHmac('sha1',SECRET).update(credentials.username).digest('base64'));assert.equal(JSON.stringify(room).includes(SECRET),false);
  const revoked=(await create(app)).data;await app.request('/v1/rooms/'+revoked.roomId,{method:'DELETE',token:revoked.token});assert.equal((await app.request('/v1/rooms/'+revoked.roomId+'/signal',{token:revoked.token})).status,404);
  now+=1001;assert.equal((await app.request('/v1/rooms/'+room.roomId+'/signal',{token:room.token})).status,404);
  const big=await fetch(app.base+'/v1/rooms',{method:'POST',headers:{Authorization:'Bearer '+OWNER,'Content-Type':'application/json'},body:' '.repeat(220001)}).catch(()=>null);if(big)assert.equal(big.status,413);
  const responses=await Promise.all(Array.from({length:8},()=>create(app)));assert.ok(responses.some(x=>x.status===429));assert.ok(app.stats().rooms<=5);
 }finally{await app.close();}
});
test('public invitation flow uses real native RTC in isolated browsers; relay absent is not reported as verified', {timeout:45000},async()=>{
 const playwright=require('playwright');const origins=[];const app=await fixture({origins});let browser;
 const files=http.createServer((req,res)=>{const file=req.url==='/peer.js'?'peer.js':req.url==='/network.js'?'network.js':null;if(file){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(__dirname,'../src/p2p',file)));}else res.end('<!doctype html><title>Public room local verification</title>');});
 await new Promise(resolve=>files.listen(0,'127.0.0.1',resolve));const pageURL='http://127.0.0.1:'+files.address().port;origins.push(pageURL);
 try{
  browser=await playwright.chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const pages=await Promise.all(contexts.map(c=>c.newPage()));await Promise.all(pages.map(p=>p.goto(pageURL)));
  await Promise.all(pages.map(p=>p.evaluate(async config=>{const {PublicPeerSession}=await import('/network.js');window.received=[];window.transportErrors=[];window.session=new PublicPeerSession({...config,onMessage:m=>received.push(m),onError:e=>transportErrors.push(e.message)});},{serverUrl:app.base,ownerToken:OWNER})));
  const invite=await pages[0].evaluate(()=>session.create({name:'房主',mode:'human'}));await pages[1].evaluate(code=>session.join(code,{name:'访客'}),invite.code);
  await Promise.all(pages.map(p=>p.waitForFunction(()=>session.info.connected)));await pages[0].evaluate(()=>session.send({type:'chat',id:'network-test',text:'真实短邀请码RTC消息'}));await pages[1].waitForFunction(()=>received.length===1);assert.equal(await pages[1].evaluate(()=>received[0].text),'真实短邀请码RTC消息');
  const report=await pages[0].evaluate(()=>session.diagnostics());assert.equal(report.connected,true);assert.equal(report.route,'direct');assert.equal(report.iceTransportPolicy,'all');
  const deadline=Date.now()+5000;while(app.stats().rooms&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));assert.equal(app.stats().rooms,0);assert.deepEqual(await pages[0].evaluate(()=>transportErrors),[]);
  await Promise.all(pages.map(p=>p.evaluate(()=>session.close())));assert.equal(await pages[1].evaluate(()=>session.info.connected),false);
  console.log('PUBLIC_FLOW_LOCAL_ONLY: capability invite + native RTC verified; no TURN service configured, no cross-NAT or relay claim');
 }finally{if(browser)await browser.close();await app.close();await new Promise(resolve=>files.close(resolve));}
});
