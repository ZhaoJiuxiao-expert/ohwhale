'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {localDay,isQuiet,agentMessages,proactiveEligibility,greetingPrompt,isDuplicateGreeting}=require('./scheduler.cjs');
const MINUTE=60000,MAX_ATTEMPTS=3;
function configFingerprint(state,agent){const p=state.providers.find(p=>p.id===agent.providerId);return crypto.createHash('sha256').update(JSON.stringify({providerId:agent.providerId,baseUrl:p?.baseUrl,model:p?.model,managed:p?.managed,consent:p?.consent,greeting:agent.greeting})).digest('hex');}
class ProactiveService {
 constructor({dir,store,harness,plugins,onNotify=()=>{},onChange=()=>{},clock=()=>new Date()}={}){
  if(!dir||!store||!harness?.generateGreeting)throw Error('主动问候需要本机存储与会话服务');
  Object.assign(this,{store,harness,plugins,onNotify,onChange,clock});
  this.dir=path.join(dir,'proactive-events');fs.mkdirSync(this.dir,{recursive:true});
  this.records=new Map();this.running=false;this.disposed=false;this.controller=null;this.lastStamp=0;
  for(const name of fs.readdirSync(this.dir).filter(name=>/^\d{16}-[a-f0-9-]+\.json$/.test(name)).sort()){
   this.lastStamp=Math.max(this.lastStamp,Number(name.slice(0,16)));
   try{const saved=JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8'));
    if(crypto.createHash('sha256').update(JSON.stringify(saved.event)).digest('hex')===saved.sha256)this.reduce(saved.event);
   }catch{} // Ignore partial files; a model call starts only after a full attempt write.
  }
 }
 reduce(event){
  if(!event||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(event.agentId)||!/^\d{4}-\d{2}-\d{2}$/.test(event.day)||!['attempt','failed','prepared','sent','suppressed'].includes(event.status)||!Number.isInteger(event.attempts)||event.attempts<1||event.attempts>MAX_ATTEMPTS)return;
  this.records.set(event.agentId+':'+event.day,event);
 }
 record(event){
  this.lastStamp=Math.max(Date.now(),this.lastStamp+1);
  const target=path.join(this.dir,String(this.lastStamp).padStart(16,'0')+'-'+crypto.randomUUID()+'.json');
  const fd=fs.openSync(target,'wx');
  try{fs.writeFileSync(fd,JSON.stringify({event,sha256:crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex')}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  this.reduce(event);return event;
 }
 enabled(){return this.plugins?.getPublic?.().settings?.proactive!==false;}
 status(now=this.clock()){
  const day=localDay(new Date(now));
  return {supported:true,backgroundEnabled:false,busy:this.running,running:this.running,disposed:this.disposed,enabled:this.enabled(),day,maxAttempts:MAX_ATTEMPTS,agents:[...this.records.values()].filter(r=>r.day===day).map(r=>({agentId:r.agentId,day:r.day,status:r.status,attempts:r.attempts,nextAttemptAt:r.nextAttemptAt||null,lastSentAt:r.status==='sent'?r.at:null,reason:r.reason||null,messageId:r.messageId||r.message?.id||null}))};
 }
 preview(now=this.clock()){
  now=new Date(now);const state=this.store.getPublic(),day=localDay(now);
  return (state.agents||[]).map(agent=>{
   const eligible=proactiveEligibility(state,agent,now),record=this.records.get(agent.id+':'+day);
   if(!this.enabled())return {agentId:agent.id,...eligible,due:false,reason:'plugin-disabled'};
   if(record?.status==='sent'||record?.status==='suppressed')return {agentId:agent.id,...eligible,due:false,reason:record.status};
   if(record&&record.status!=='prepared'&&(record.attempts>=MAX_ATTEMPTS||Date.parse(record.nextAttemptAt)>now.getTime()))return {agentId:agent.id,...eligible,due:false,reason:record.attempts>=MAX_ATTEMPTS?'attempt-limit':'backoff'};
   return {agentId:agent.id,...eligible};
  });
 }
 async notify(input,isNew){try{await this.onChange(input);}catch{}if(isNew)try{await this.onNotify(input);}catch{}}
 async deliver(record,now){
  const state=this.store.getPublic(),agent=state.agents.find(a=>a.id===record.agentId);
  const conversation=this.store.getConversation(record.conversationId);
  if(this.disposed||!agent||!agent.greeting?.enabled||!this.enabled()||localDay(now)!==record.day||!conversation||conversation.archived||record.fingerprint!==configFingerprint(state,agent)){this.record({...record,status:'suppressed',reason:'schedule-changed',at:now.toISOString()});return {agentId:record.agentId,day:record.day,status:'suppressed',reason:'schedule-changed'};}
  const existing=this.store.getMessages(record.conversationId).find(m=>m.id===record.message.id);
  if(!existing){const eligibility=proactiveEligibility(state,agent,now);if(!eligibility.due&&eligibility.reason!=='quiet-hours'){this.record({...record,status:'suppressed',reason:eligibility.reason,at:now.toISOString()});return {agentId:record.agentId,day:record.day,status:'suppressed',reason:eligibility.reason};}}
  if(!existing&&isQuiet(state,now))return {agentId:record.agentId,day:record.day,status:'deferred',reason:'quiet-hours'};
  const message=existing||this.store.addMessage(record.conversationId,{...record.message,role:'assistant',source:'ai',greeting:true,status:'sent',attachments:[]});
  // A crash between chat persistence and this marker is recovered by message ID.
  this.store.markGreeting(record.agentId,record.day);
  this.record({agentId:record.agentId,day:record.day,status:'sent',attempts:record.attempts,messageId:message.id,at:now.toISOString()});
  await this.notify({agentId:agent.id,agentName:agent.name,conversationId:record.conversationId,messageId:message.id},!existing);
  return {agentId:record.agentId,day:record.day,status:'sent',messageId:message.id};
 }
 async tick(now=this.clock()){
  now=new Date(now);if(!Number.isFinite(now.getTime()))throw Error('主动问候时间无效');
  if(this.running||this.disposed||!this.enabled())return {busy:this.running,outcomes:[]};
  this.running=true;this.controller=new AbortController();
  try{
   // Finish a persisted generated reply before requesting another model reply.
   const prepared=[...this.records.values()].find(r=>r.status==='prepared');
   if(prepared)return {outcomes:[await this.deliver(prepared,now)]};
   const candidate=this.preview(now).find(r=>r.due);if(!candidate)return {outcomes:[]};
   const state=this.store.getPublic(),agent=state.agents.find(a=>a.id===candidate.agentId),day=localDay(now),previous=this.records.get(agent.id+':'+day);
   const conversation=state.conversations.filter(c=>c.type==='ai'&&c.agentId===agent.id&&!c.archived).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0]||this.store.createConversation({agentId:agent.id,type:'ai'});
   // Do not spend an attempt while the user is already getting an answer.
   if(this.harness.active?.has(conversation.id))return {outcomes:[]};
   const attempts=(previous?.attempts||0)+1;
   const attempt=this.record({agentId:agent.id,day,status:'attempt',attempts,at:now.toISOString(),nextAttemptAt:new Date(now.getTime()+30*MINUTE).toISOString()});
   let generated;const startedAt=new Date(this.clock()).getTime(),fingerprint=configFingerprint(state,agent);
   try{
    const prior=agentMessages(state,agent.id).filter(m=>m.greeting&&m.role==='assistant').map(m=>m.text).slice(-20);
    generated=await this.harness.generateGreeting({conversationId:conversation.id,greetingContext:greetingPrompt({mode:candidate.mode,day,previousTexts:prior}),signal:this.controller.signal});
    if(this.disposed||this.controller.signal.aborted)throw Object.assign(Error('主动问候已取消'),{code:'CANCELLED'});
    const text=generated?.text?.trim();
    const reason=!text||text.length>600?'invalid-length':isDuplicateGreeting(text,prior)?'duplicate':null;
    if(reason){this.record({...attempt,status:'suppressed',reason,nextAttemptAt:null});return {outcomes:[{agentId:agent.id,day,status:'suppressed',reason}]};}
    const finishedAt=new Date(now.getTime()+Math.max(0,new Date(this.clock()).getTime()-startedAt));
    const record=this.record({agentId:agent.id,day,status:'prepared',attempts,conversationId:conversation.id,fingerprint,message:{id:crypto.randomUUID(),text,model:generated.model,createdAt:finishedAt.toISOString()},at:finishedAt.toISOString()});
    return {outcomes:[await this.deliver(record,finishedAt)]};
   }catch(error){
    // If a generated reply was journalled, retry delivery without another API call.
    if(this.records.get(agent.id+':'+day)?.status==='prepared')return {outcomes:[{agentId:agent.id,day,status:'failed',reason:'delivery-pending'}]};
    const rateLimited=error.status===429||error.statusCode===429||['RATE_LIMIT','LIMIT','MANAGED_RATE_LIMIT'].includes(error.code)||/\b429\b/.test(error.message||'');
    const delay=Math.max(15*2**(attempts-1),rateLimited?30:0)*MINUTE;
    this.record({...attempt,status:'failed',reason:rateLimited?'rate-limit':String(error.code||'ERROR').slice(0,40),nextAttemptAt:new Date(now.getTime()+delay).toISOString()});
    return {outcomes:[{agentId:agent.id,day,status:'failed',reason:rateLimited?'rate-limit':String(error.code||'ERROR').slice(0,40)}]};
   }
  }finally{this.running=false;this.controller=null;}
 }
 dispose(){this.disposed=true;this.controller?.abort();}
}
module.exports={ProactiveService};
