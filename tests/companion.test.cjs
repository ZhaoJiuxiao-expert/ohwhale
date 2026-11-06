const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ChatStore}=require('../src/core/store.cjs'),{VoiceSession,speechText}=require('../src/core/voice-session.cjs');
test('default persona upgrades preserve custom edits, memories, provider choices and prior snapshots',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whale-companion-')),args={dir,encrypt:x=>'cipher:'+x,decrypt:x=>x.slice(7)},store=new ChatStore(args),legacy=require('../src/data/agents-v1.1.json');
 store.change(s=>{s.agents=JSON.parse(JSON.stringify(legacy));s.agents[0].memory='已确认的秘密小记';s.agents[1].persona='用户自己写的独特角色';s.agents[1].name='自定义名字';return true;});
 const files=fs.readdirSync(dir),before=files.map(f=>[f,fs.readFileSync(path.join(dir,f))]),restored=new ChatStore(args).getPublic();
 assert(restored.agents[0].persona.includes('白饭搭子')||restored.agents[0].tags.includes('白饭搭子'));assert.equal(restored.agents[0].memory,'已确认的秘密小记');assert.equal(restored.agents[0].providerId,'atlas');
 assert.equal(restored.agents[1].persona,'用户自己写的独特角色');assert.equal(restored.agents[1].name,'自定义名字');
 for(const[f,b]of before)assert(fs.readFileSync(path.join(dir,f)).equals(b));
 const count=fs.readdirSync(dir).length;new ChatStore(args);assert.equal(fs.readdirSync(dir).length,count);
});
test('voice text hides sticker protocol without changing math or original message',()=>{
 const input='## 好呀\n**一起想想** [sticker:deepseek-007] [sticker:custom-a_b-1] 2*3=6。\n[点这里](https://example.com) 🐟';
 assert.equal(speechText(input),'好呀\n一起想想 2*3=6。\n点这里');assert(input.includes('[sticker:deepseek-007]'));
});
test('voice sessions deduplicate same message, stop stale synthesis and allow next request',async()=>{
 const session=new VoiceSession();let calls=0;
 const first=session.run('room:one',signal=>new Promise((resolve,reject)=>{calls++;signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});}));
 const duplicate=session.run('room:one',()=>{throw Error('duplicate');});assert.equal(first,duplicate);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 assert.equal(session.stop('other:'),false);const second=session.run('room:two',async()=> 'new voice');await assert.rejects(first,/cancelled/);assert.equal(await second,'new voice');assert.equal(session.active,null);
});
