'use strict';

// The quick start shares connections, never private conversations or memories.
const PREFERRED={
 deepseek:['deepseek-ai/deepseek-v4.1-flash','deepseek-ai/deepseek-v4-flash'],
 qwen:['qwen/qwen3.5-flash','qwen/qwen3.8-27b'],
 kimi:['moonshotai/kimi-k2.6','moonshotai/kimi-k2.5'],
 doubao:['bytedance/doubao-seed-character-260628','bytedance/doubao-seed-2.0-mini-260428']
};
const FAMILY={deepseek:/deepseek/i,qwen:/qwen|千问/i,kimi:/kimi|moonshot/i,doubao:/doubao|豆包/i};
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('小屋连接单不完整，请重新打开。');return value;}
function ids(value){if(!Array.isArray(value)||!value.length||value.length>8||value.some(x=>typeof x!=='string'||!x||x.length>100)||new Set(value).size!==value.length)throw Error('一次请选择一到八位不同的伙伴。');return value;}
function ready(provider){if(!provider?.consent)return false;try{return !!(provider.managed||provider.hasKey||/^http:$/.test(new URL(provider.baseUrl).protocol)&&['localhost','127.0.0.1','[::1]'].includes(new URL(provider.baseUrl).hostname));}catch{return false;}}
class HouseSetup{
 constructor({store,managed}){this.store=store;this.managed=managed;this.busy=false;}
 selected(agentIds){const state=this.store.getPublic();const agents=ids(agentIds).map(id=>{const agent=state.agents.find(a=>a.id===id);if(!agent)throw Error('这位伙伴已经不在小屋里，请刷新后再选。');return agent;});return {state,agents};}
 async plan(input){
  object(input,['agentIds']);const {state,agents}=this.selected(input.agentIds),providers=state.providers.filter(ready);let catalog=null,catalogError='';
  if(agents.some(a=>!providers.some(p=>p.id===a.providerId)&&PREFERRED[a.id])){try{catalog=await this.managed.catalog();if(!catalog.enabled)catalogError='免填密钥的聊天小站暂时休息了，可以用已有连接。';}catch(e){catalogError='暂时没读到伙伴的聊天小菜单，请稍后重试，或用已有连接。';}}
  const models=catalog?.enabled?catalog.models:[];
  const assignments=agents.map(agent=>{
   const current=providers.find(p=>p.id===agent.providerId);if(current)return {agentId:agent.id,name:agent.name,ready:true,model:current.model,modelName:current.name,providerId:current.id};
   let selected=PREFERRED[agent.id]?.map(id=>models.find(m=>m.id===id)).find(Boolean)||models.find(m=>FAMILY[agent.id]?.test(m.id+' '+m.name));
   const fallback=!selected&&Boolean(PREFERRED[agent.id]);if(fallback)selected=models.find(m=>m.id===PREFERRED.deepseek[0])||models.find(m=>FAMILY.deepseek.test(m.id));
   return {agentId:agent.id,name:agent.name,ready:false,...(selected?{model:selected.id,modelName:selected.name,fallback,vision:selected.vision}:{requiresOwn:!PREFERRED[agent.id]})};
  });
  return {assignments,providers:providers.map(p=>({id:p.id,name:p.name,model:p.model,managed:!!p.managed})),limits:catalog?.limits||null,privacy:catalog?.privacy||null,catalogError};
 }
 async connect(input){
  object(input,['agentIds','mode','assignments','providerId','consent']);this.selected(input.agentIds);if(input.consent!==true)throw Error('先确认聊天内容的发送范围，再让伙伴们开口吧。');if(this.busy)throw Error('伙伴们正在连线，稍等一下呀。');
  if(!['suggested','existing'].includes(input.mode))throw Error('请选择一种聊天连接。');this.busy=true;
  try{
   let provider,available;
   if(input.mode==='existing'){provider=this.store.getPublic().providers.find(p=>p.id===input.providerId);if(!ready(provider))throw Error('这份连接还没准备好，请先完成设置。');}
   else{
    if(!Array.isArray(input.assignments)||input.assignments.length!==input.agentIds.length)throw Error('伙伴连接单已变化，请重新查看。');
    const seen=new Set();for(const a of input.assignments){object(a,['agentId','model']);if(!input.agentIds.includes(a.agentId)||seen.has(a.agentId)||typeof a.model!=='string'||a.model.length>200||!a.model)throw Error('伙伴连接单已变化，请重新查看。');seen.add(a.agentId);}
    available=await this.managed.catalog();if(!available.enabled)throw Error('聊天小站暂时休息了，已有设置会保留。');
    for(const a of input.assignments){const {state,agents}=this.selected([a.agentId]);if(ready(state.providers.find(p=>p.id===agents[0].providerId)))continue;if(!PREFERRED[a.agentId])throw Error('这位伙伴需要选择自己的连接，请打开更多设置。');if(!available.models.some(m=>m.id===a.model))throw Error('刚选的聊天模型暂时不在小菜单里，请重新查看；没有替你换模型。');}
   }
   const connected=[];
   for(const agentId of input.agentIds){
    const {state,agents}=this.selected([agentId]);const agent=agents[0],existing=state.providers.find(p=>p.id===agent.providerId);
    // Preserve intentional existing bindings, including custom endpoints and keys.
    if(ready(existing)){connected.push({agentId,kept:true});continue;}
    if(input.mode==='existing')this.store.saveAgent({...agent,providerId:provider.id});
    else await this.managed.connect({agentId,model:input.assignments.find(a=>a.agentId===agentId).model,consent:true});
    connected.push({agentId,kept:false});
   }
   return {connected};
  }finally{this.busy=false;}
 }
}
module.exports={HouseSetup,houseProviderReady:ready};
