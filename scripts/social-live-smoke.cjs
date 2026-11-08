'use strict';
// Explicit opt-in release smoke: synthetic identities only, no provider/model calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {FriendsClient}=require('../src/core/friends-client.cjs'),{GroupsClient}=require('../src/core/groups-client.cjs');
if(!process.argv.includes('--authorized-live-qa'))throw Error('Live QA must be explicitly selected');
const root=path.resolve(__dirname,'..'),stamp=Date.now(),dir=path.join(os.homedir(),'Documents','ai聊天软件','developer','qa','social-live-'+stamp),out=path.join(root,'artifacts','social-live-'+stamp+'.json');
fs.mkdirSync(dir,{recursive:true});const key=crypto.randomBytes(32);fs.writeFileSync(path.join(dir,'qa-storage.key'),key,{flag:'wx',mode:0o600});
const encrypt=text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text,'utf8'),c.final(),c.getAuthTag()]).toString('base64')};
const decrypt=text=>{const raw=Buffer.from(text,'base64'),d=crypto.createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));d.setAuthTag(raw.subarray(-16));return Buffer.concat([d.update(raw.subarray(12,-16)),d.final()]).toString('utf8')};
const checks=[];const ok=(name,value=true)=>{assert(value,name);checks.push(name)};
async function main(){
 const clients=[];for(const name of ['A','B','C']){const friends=new FriendsClient({dir:path.join(dir,name,'friends'),serverUrl:'https://47.86.23.218',encrypt,decrypt});await friends.enable({name:'版本验收'+name+'-'+String(stamp).slice(-6),consent:true});clients.push(friends)}
 const [a,b,c]=clients;await a.request({code:b.status().self.code});const request=(await b.state()).requests.incoming.find(r=>r.from.id===a.status().self.id);await b.respond({requestId:request.id,accept:true});ok('synthetic friendship accepted');
 let modelCalls=0;const groups=clients.map((friends,i)=>new GroupsClient({dir:path.join(dir,String(i),'groups'),friends,store:{},media:{validated:v=>v},encrypt,decrypt,harness:{selection:()=>({agent:{id:'qa-agent',name:'验收角色'+i,persona:'仅用于合成验收。'},provider:{model:'synthetic-fixture-no-llm'}}),bounded:(_c,fn)=>fn(),request:async()=>{modelCalls++;return {text:'合成验收回复：'+i}}}}));
 const [ga,gb,gc]=groups;const {group}=await ga.create({name:'群聊版本验收-'+String(stamp).slice(-6),description:'合成测试群，验收后关闭。',consent:true});const groupId=group.id;
 await ga.invite({groupId,friendId:b.status().self.id});const inv=(await gb.overview()).invitations.find(x=>x.groupId===groupId);await gb.respondInvite({invitationId:inv.id,accept:true,consent:true});
 const invite=await ga.createInvite({groupId});assert.equal((await gc.join({code:invite.code,consent:true})).status,'pending');await ga.manage({groupId,action:'approve',memberId:c.status().self.id,accept:true});ok('friend invitation and code approval');
 await ga.manage({groupId,action:'member',memberId:b.status().self.id,role:'admin',rights:{manageAgents:true}});
 const ba=await ga.addAgent({groupId,agentId:'qa-agent',consent:true}),bb=await gb.addAgent({groupId,agentId:'qa-agent',consent:true});
 await gc.send({groupId,clientId:crypto.randomUUID(),text:'合成验收：两位角色各回复一次。',mentions:[ba.botId,bb.botId],attachments:[]});await ga.tick();await gb.tick();const pages=await Promise.all(groups.map(g=>g.get({groupId})));assert.equal(pages[0].messages.filter(x=>x.senderType==='ai').length,2);assert.deepEqual(pages[0].messages,pages[1].messages);assert.deepEqual(pages[1].messages,pages[2].messages);await ga.tick();await gb.tick();assert.equal(modelCalls,2);ok('three HTTPS clients share two explicit AI fixture replies without loops');
 await ga.manage({groupId,action:'member',memberId:c.status().self.id,mutedUntil:Date.now()+60000});await assert.rejects(gc.send({groupId,clientId:crypto.randomUUID(),text:'must not send',mentions:[],attachments:[]}));ok('server mute enforced');
 await ga.manage({groupId,action:'remove-member',memberId:c.status().self.id,ban:true});await assert.rejects(gc.get({groupId}));ok('removed member cannot read');
 await ga.manage({groupId,action:'close'});for(const g of groups)g.dispose();ok('synthetic group closed and retained');
 if(process.argv.includes('--moments')){
  const {MomentsClient}=require('../src/core/moments-client.cjs');const moments=clients.map(friends=>new MomentsClient({friends,media:{validated:v=>v,resolve:()=>{throw Error('This text-only QA must not resolve media')}}}));const [ma,mb,mc]=moments;
  const {post}=await ma.publish({clientId:crypto.randomUUID(),text:'哦鲸鲸版本验收：公开动态、点赞与评论功能测试。',visibility:'friends',consent:true,attachments:[]});await assert.rejects(mc.get({postId:post.id}));await mb.get({postId:post.id});ok('friends-only post excludes stranger');
  await ma.visibility({postId:post.id,visibility:'public',consent:true});ok('public feed includes explicitly published post',(await mc.feed({scope:'public'})).posts.some(p=>p.id===post.id));await mc.like({postId:post.id,liked:true});const liked=await mc.like({postId:post.id,liked:true});assert.equal(liked.post.likeCount,1);const comment=await mc.comment({postId:post.id,clientId:crypto.randomUUID(),text:'合成验收评论'});assert.equal((await mb.get({postId:post.id})).comments.length,1);ok('public comments and unique likes');
  await ma.deleteComment({postId:post.id,commentId:comment.comment.id});await ma.visibility({postId:post.id,visibility:'friends',consent:true});await assert.rejects(mc.get({postId:post.id}));ok('visibility reduction immediately revokes stranger access');await ma.deletePost({postId:post.id});ok('synthetic post hidden with retained history');
 }
 fs.writeFileSync(out,JSON.stringify({at:new Date().toISOString(),server:'https://47.86.23.218',syntheticOnly:true,noPaidModels:true,checks,credentialDirectory:dir},null,2),{flag:'wx'});console.log(JSON.stringify({report:out,checks:checks.length,noPaidModels:true}));
}
main().catch(e=>{fs.writeFileSync(out,JSON.stringify({at:new Date().toISOString(),checks,error:e.message,credentialDirectory:dir},null,2),{flag:'wx'});console.error(e.message);process.exitCode=1});
