'use strict';
function obj(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('托管服务回应格式不完整，请稍后再试。');return value;}
function text(v,max){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))throw Error('托管服务的文字或模型标识不完整。');return v;}
function number(v,max=1e9){if(!Number.isSafeInteger(v)||v<0||v>max)throw Error('托管服务的额度信息不完整。');return v;}
function catalog(value){
 obj(value,['enabled','models','limits','privacy']);if(typeof value.enabled!=='boolean'||!Array.isArray(value.models)||value.models.length>128)throw Error('托管模型列表暂时读不到。');const models=value.models.map(m=>{obj(m,['id','name','vision']);if(typeof m.vision!=='boolean')throw Error('模型能力标记不完整。');return {id:text(m.id,200),name:text(m.name,80),vision:m.vision};});if(new Set(models.map(m=>m.id)).size!==models.length)throw Error('模型列表含重复项。');
 obj(value.limits,['perMinute','perDay','concurrent','globalPerDay','maxOutputTokens']);const limits={};for(const key of ['perMinute','perDay','concurrent','globalPerDay','maxOutputTokens'])limits[key]=number(value.limits[key]);obj(value.privacy,['processor','region']);const privacy={processor:text(value.privacy.processor,100),region:text(value.privacy.region,400)};return {enabled:value.enabled,models,limits,privacy};
}
function abort(signal){if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:Error('这次回复已取消。');}
class ManagedClient{
 constructor({store,friends,fetch:fetcher}={}){if(!store||!friends)throw Error('托管服务尚未准备好。');this.store=store;this.friends=friends;this.fetch=fetcher;}
 _request(route,options={}){return this.friends.managedRequest(route,{...options,...(this.fetch?{fetch:this.fetch}:{})});}
 async catalog(){return catalog(await this._request('models'));}
 async usage(){const r=await this._request('usage');obj(r,['day','requestsUsed','requestsRemaining','perMinute','perDay','concurrent']);if(typeof r.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.day))throw Error('托管用量日期不完整。');return {day:r.day,requestsUsed:number(r.requestsUsed),requestsRemaining:number(r.requestsRemaining),perMinute:number(r.perMinute),perDay:number(r.perDay),concurrent:number(r.concurrent)};}
 async connect(input){
  obj(input,['agentId','model','consent']);if(input.consent!==true)throw Error('请先确认托管聊天和设备身份的数据发送范围。');text(input.agentId,100);text(input.model,200);const current=this.store.getPublic();if(!current.agents.some(a=>a.id===input.agentId))throw Error('先选择一位角色伙伴吧。');
  const available=await this.catalog();if(!available.enabled)throw Error('托管聊天还没开启，可以先使用自己的 API 呀。');const selected=available.models.find(m=>m.id===input.model);if(!selected)throw Error('这个模型不在当前托管名单里，请重新选择。');
  if(!this.friends.status().enabled){const display=current.settings.displayName;const name=typeof display==='string'&&display!=='我'&&display.trim()&&display.length<=60&&!/[\x00-\x1f\x7f/\\:]/.test(display)&&!display.includes('..')?display.trim():'一位鲸友';await this.friends.enable({name,consent:true});}
  if(this.store.managedBase!==this.friends.serverUrl+'/v1/managed')throw Error('托管服务与本机身份不在同一站点，已停止连接。');return this.store.bindManagedProvider({agentId:input.agentId,model:selected.id,name:'小鲸托管 · '+selected.name.slice(0,70),vision:selected.vision,consent:true});
 }
 async request({provider,messages,signal}){
  abort(signal);if(provider?.managed!==true||provider.consent!==true||provider.baseUrl!==this.friends.serverUrl+'/v1/managed'||Object.hasOwn(provider,'apiKey')||Object.hasOwn(provider,'encryptedApiKey'))throw Error('这份托管连接配置不完整，请重新连接角色。');
  text(provider.model,200);if(!Array.isArray(messages)||messages.length<1||messages.length>25)throw Error('这段上下文有点长，请新建聊天后再试。');const body={model:provider.model,messages,stream:false,max_tokens:4096};if(new TextEncoder().encode(JSON.stringify(body)).byteLength>8*1024*1024)throw Error('这次图片和文字有点多，请缩小图片后再试。');
  const r=await this._request('chat/completions',{body,signal});abort(signal);obj(r,['choices','usage']);if(!Array.isArray(r.choices)||r.choices.length!==1)throw Error('模型回复结构不完整，请稍后手动重试。');const c=r.choices[0];obj(c,['index','message','finish_reason']);obj(c.message,['role','content']);if(c.index!==0||c.finish_reason!=='stop'||c.message.role!=='assistant'||typeof c.message.content!=='string'||!c.message.content.trim()||c.message.content.length>200000)throw Error('这次模型没有完整说完，请缩短问题后手动重试。');
  let usage;if(r.usage!==undefined){obj(r.usage,['prompt_tokens','completion_tokens','total_tokens']);usage={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(r.usage[key]!==undefined)usage[key]=number(r.usage[key]);}return {text:c.message.content,usage,finish:'stop'};
 }
}
module.exports={ManagedClient};
