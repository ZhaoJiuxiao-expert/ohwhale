'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {FriendsClient,FRIENDS_METHODS}=require('../src/core/friends-client.cjs');
const SELF={id:'1'.repeat(32),code:'JW-ABCD-EFGH-JKLM',name:'小鲸'};
const PEER={id:'2'.repeat(32),code:'JW-NPQR-STUV-WXYZ',name:'伙伴'};
const TOKEN='fake_device_credential_'+crypto.randomBytes(32).toString('base64url');
const origin='https://friends.example';
function fixture({response,dir,encrypt,decrypt}={}){
 const folder=dir||fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-friends-client-')),key=crypto.randomBytes(32),requests=[];
 const encryptFn=encrypt||((value)=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');});
 const decryptFn=decrypt||((value)=>{const b=Buffer.from(value,'base64'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString();});
 const fetch=async(url,options)=>{requests.push({url,options});return response?response(url,options):new Response(JSON.stringify(url.endsWith('/register')?{self:SELF,token:TOKEN}:url.endsWith('/state')?{self:SELF,contacts:[{...PEER,online:true}],requests:{incoming:[],outgoing:[]},calls:[]}:{ok:true}),{status:200});};
 const config={dir:folder,serverUrl:origin,fetch,encrypt:encryptFn,decrypt:decryptFn};return {client:new FriendsClient(config),config,dir:folder,requests};
}
test('friend identity is opt in, public credentials are absent and restart retains the same identity',async()=>{
 const x=fixture();assert.deepEqual(x.client.status(),{enabled:false,serverUrl:origin});assert.equal(x.requests.length,0);
 assert.throws(()=>x.client.enable({name:'小鲸',consent:false}),/同意/);await assert.rejects(x.client.state(),/开启/);assert.equal(x.requests.length,0);
 const status=await x.client.enable({name:'小鲸',consent:true});assert.equal(status.enabled,true);assert.deepEqual(status.self,SELF);assert.ok(!JSON.stringify(status).includes(TOKEN));
 const names=fs.readdirSync(x.dir);assert.equal(names.length,1);assert.ok(!fs.readFileSync(path.join(x.dir,names[0]),'utf8').includes(TOKEN));
 const again=new FriendsClient(x.config);assert.deepEqual(again.status(),status);await again.enable({name:'不更换身份',consent:true});assert.equal(x.requests.length,1);
 const state=await again.state();assert.equal(state.contacts[0].name,'伙伴');assert.equal(x.requests[1].options.headers.Authorization,'Bearer '+TOKEN);assert.equal(x.requests[1].options.redirect,'error');assert.equal(x.requests[1].options.credentials,'omit');assert.ok(!JSON.stringify(state).includes(TOKEN));
});
test('concurrent enable is deduplicated and unsupported settings cannot retarget a credential',async()=>{
 const x=fixture();const results=await Promise.all([x.client.enable({name:'小鲸',consent:true}),x.client.enable({name:'小鲸',consent:true})]);assert.deepEqual(results[0],results[1]);assert.equal(x.requests.length,1);
 assert.throws(()=>x.client.request({code:PEER.code,serverUrl:'https://evil.example'}),/格式/);assert.equal(x.requests.length,1);
 const other=new FriendsClient({...x.config,serverUrl:'https://other.example'});assert.equal(other.status().enabled,false);assert.match(other.status().error,/保留原件/);await assert.rejects(other.state(),/保留原件/);assert.equal(x.requests.length,1);
});
test('corrupt saved identity fails closed without discarding any original file',async()=>{
 const x=fixture();await x.client.enable({name:'小鲸',consent:true});const first=fs.readdirSync(x.dir)[0],before=fs.readFileSync(path.join(x.dir,first));const bad='identity-9999999999999-'+crypto.randomUUID()+'.json';fs.writeFileSync(path.join(x.dir,bad),'{broken');
 const restored=new FriendsClient(x.config);assert.equal(restored.status().enabled,false);assert.throws(()=>restored.enable({name:'小鲸',consent:true}),/保留原件/);assert.equal(fs.readdirSync(x.dir).length,2);assert.deepEqual(fs.readFileSync(path.join(x.dir,first)),before);assert.equal(x.requests.length,1);
});
test('rejects unencrypted storage and rejects invalid credentials before authenticated network calls',async()=>{
 const x=fixture({encrypt:s=>s});await assert.rejects(x.client.enable({name:'小鲸',consent:true}),/安全存储/);assert.equal(fs.readdirSync(x.dir).length,0);
 const y=fixture();await y.client.enable({name:'小鲸',consent:true});const corrupt=new FriendsClient({...y.config,decrypt:()=>{throw Error('PRIVATE_DETAIL');}});await assert.rejects(corrupt.state(),e=>/凭据/.test(e.message)&&!e.message.includes('PRIVATE_DETAIL'));assert.equal(y.requests.length,1);
});
test('mutation requests only send normalized, specifically permitted fields and strict booleans',async()=>{
 const x=fixture();await x.client.enable({name:'小鲸',consent:true});await x.client.request({code:PEER.code});await x.client.respond({requestId:'a'.repeat(32),accept:true});await x.client.block({friendId:PEER.id});await x.client.respondCall({callId:'b'.repeat(32),accept:false});await x.client.endCall({callId:'b'.repeat(32)});
 assert.deepEqual(x.requests.slice(1).map(r=>JSON.parse(r.options.body)),[{code:PEER.code},{requestId:'a'.repeat(32),accept:true},{friendId:PEER.id},{callId:'b'.repeat(32),accept:false},{callId:'b'.repeat(32)}]);
 assert.throws(()=>x.client.respond({requestId:'a'.repeat(32),accept:'true'}),/明确/);assert.throws(()=>x.client.request({code:'https://evil.example'}),/鲸鲸号/);assert.throws(()=>x.client.block({friendId:'../private'}),/标识/);
});
test('HTTP authentication failures are bounded safe errors rather than arbitrary server output',async()=>{
 let failure=false;const x=fixture({response:url=>new Response(JSON.stringify(failure?{error:{code:'UNAUTHORIZED',message:TOKEN+' PRIVATE_BACKEND_LOG'}}:{self:SELF,token:TOKEN}),{status:failure?401:200})});await x.client.enable({name:'小鲸',consent:true});failure=true;
 await assert.rejects(x.client.state(),e=>e.code==='UNAUTHORIZED'&&!e.message.includes(TOKEN)&&!e.message.includes('PRIVATE_BACKEND_LOG'));assert.equal(x.client.status().enabled,true);
});
test('public state rejects a credential leak, foreign identity and oversized response',async()=>{
 let data={self:SELF,token:TOKEN};const x=fixture({response:()=>new Response(JSON.stringify(data),{status:200})});await x.client.enable({name:'小鲸',consent:true});
 data={self:SELF,contacts:[],requests:{incoming:[],outgoing:[]},calls:[],token:TOKEN};await assert.rejects(x.client.state(),/格式/);
 delete data.token;data.self=PEER;await assert.rejects(x.client.state(),/不一致/);
 data='x'.repeat(600000);await assert.rejects(x.client.state(),/过大/);
});
test('session grants are scoped to current origin and contain only temporary room capabilities',async()=>{
 let data={self:SELF,token:TOKEN};const x=fixture({response:()=>new Response(JSON.stringify(data),{status:200})});await x.client.enable({name:'小鲸',consent:true});
 data={serverUrl:origin,host:true,peer:PEER,room:{roomId:'c'.repeat(32),token:'r'.repeat(43),expiresAt:Date.now()+120000,credentialExpiresAt:Date.now()+900000,iceServers:[{urls:['stun:relay.example:3478','stuns:relay.example:5349','turn:relay.example:3478?transport=udp','turns:relay.example:5349?transport=tcp'],username:'test',credential:'ephemeral'}],mode:'human',policy:'all'}};
 const grant=await x.client.session({callId:'b'.repeat(32)});assert.equal(grant.room.token,'r'.repeat(43));assert.ok(!JSON.stringify(grant).includes(TOKEN));data.serverUrl='https://evil.example';await assert.rejects(x.client.session({callId:'b'.repeat(32)}),/其他服务/);data.serverUrl=origin;data.room.iceServers[0].urls=['https://evil.example'];await assert.rejects(x.client.session({callId:'b'.repeat(32)}),/中继/);
});
test('desktop and Android bridges expose the same bounded methods; Android keeps model and friend credentials separate',()=>{
 const root=path.resolve(__dirname,'..'),main=fs.readFileSync(path.join(root,'src/main.cjs'),'utf8'),preload=fs.readFileSync(path.join(root,'src/preload.cjs'),'utf8'),runtime=fs.readFileSync(path.join(root,'src/mobile/runtime.cjs'),'utf8'),java=fs.readFileSync(path.join(root,'android/src/cn/ohwhale/chat/MainActivity.java'),'utf8');
 for(const key of Object.keys(FRIENDS_METHODS))assert.ok(preload.includes("'"+key+"'"));assert.ok(main.includes('Object.entries(FRIENDS_METHODS)'));assert.ok(runtime.includes('Object.entries(FRIENDS_METHODS)'));
 assert.ok(runtime.includes("native.sync('friendsSecretPut'"));assert.ok(runtime.includes("'@android-friend:'"));assert.ok(java.includes('vault.friendSecret('));assert.ok(java.includes('"friend-secret:"+id'));assert.ok(java.includes('endsWith("/chat/completions")'));assert.ok(java.includes('PermissionRequest.RESOURCE_VIDEO_CAPTURE'));assert.ok(java.includes('Manifest.permission.CAMERA'));
});
