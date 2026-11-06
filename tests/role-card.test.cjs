const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ChatStore}=require('../src/core/store.cjs');
const {exportRoleCard,importRoleCard}=require('../src/core/role-card.cjs');
function store(){return new ChatStore({dir:fs.mkdtempSync(path.join(os.tmpdir(),'whale-card-')),encrypt:s=>'encrypted:'+s,decrypt:s=>s.slice(10)});}
test('portable role card carries custom avatar bytes but no owner key, model binding, memory, history or schedule',()=>{
 const owner=store(),guest=store(),originalId='11111111-1111-1111-1111-111111111111',newId='22222222-2222-2222-2222-222222222222';
 owner.saveProvider({id:'atlas',apiKey:'owner-secret-key'});owner.saveAgent({id:'deepseek',avatar:'lingyu-media://asset/'+originalId,memory:'owner-private-note',greeting:{enabled:true,hour:8}});
 const c=owner.createConversation({agentId:'deepseek'});owner.addMessage(c.id,{role:'user',text:'owner-chat-secret'});
 const dataUrl='data:image/png;base64,aGVsbG8=',card=exportRoleCard({store:owner,media:{resolve:id=>{assert.equal(id,originalId);return {dataUrl,type:'image'};}},agentId:'deepseek'});
 for(const privateText of ['owner-secret-key','owner-private-note','owner-chat-secret','providerId','greeting','encryptedApiKey'])assert(!JSON.stringify(card).includes(privateText));assert.equal(card.character.avatar,'');assert.equal(card.avatar.dataUrl,dataUrl);
 const imported=importRoleCard({store:guest,input:card,media:{fromData:asset=>{assert.equal(asset.dataUrl,dataUrl);assert.equal(asset.type,'image');return {url:'lingyu-media://asset/'+newId};}}});
 assert.equal(imported.avatar,'lingyu-media://asset/'+newId);assert.equal(imported.providerId,'');assert.equal(imported.memory,'');assert.equal(imported.greeting.enabled,false);assert.notEqual(imported.id,'deepseek');assert.deepEqual(imported.importWarnings,[]);
});
test('legacy missing avatar and unknown fields are disclosed; invalid persona rejects before media writes',()=>{
 const s=store();let writes=0;const media={fromData:()=>{writes++;throw Error('unexpected write');}};
 const legacy=s.exportAgent('deepseek');legacy.avatar='lingyu-media://asset/11111111-1111-1111-1111-111111111111';legacy.futureField={keepInOriginal:true};
 const imported=importRoleCard({store:s,media,input:legacy});assert.equal(imported.avatar,'');assert.equal(imported.importWarnings.length,2);assert.equal(writes,0);
 const invalid={format:'ohwhale-character',version:2,character:{name:'',persona:'test'},avatar:{dataUrl:'data:image/png;base64,aGVsbG8='}};
 assert.throws(()=>importRoleCard({store:s,media,input:invalid}));assert.equal(writes,0);
 assert.throws(()=>importRoleCard({store:s,media,input:{format:'ohwhale-character',version:2,character:{name:'x'},avatar:{dataUrl:'https://evil.example/avatar.png'}}}));
});
