'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const defaults = require('../data/agents.json');
const legacyDefaults = require('../data/agents-v1.1.json');
const networkDefaults=require('../data/network-defaults.json');
const clone = value => JSON.parse(JSON.stringify(value));
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
function object(value, label = '数据') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}格式无效`);
  return value;
}
function str(value, label, max, min = 0) {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0') || (min>0&&!value.trim())) throw new Error(`${label}须为 ${min}–${max} 字符的文本`);
  return value;
}
function id(value, label = '标识') {
  str(value, label, 100, 1);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error(`${label}无效`);
  return value;
}
function bool(value, label) { if (typeof value !== 'boolean') throw new Error(`${label}须为开关值`); return value; }
function integer(value, label, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}超出范围`); return value; }
function choice(value, choices, label) { if (!choices.includes(value)) throw new Error(`${label}无效`); return value; }
function endpoint(value) {
  str(value, '服务地址', 2048, 1);
  let url; try { url = new URL(value); } catch { throw new Error('服务地址无效'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || /[?#]/.test(value) || /^[a-z]+:\/\/[^/]*@/i.test(value)) throw new Error('服务地址只支持 HTTPS 或本机 HTTP，且不得包含账号、查询参数或片段');
  return url.href.replace(/\/+$/, '');
}
function attachment(value) {
  object(value, '附件');
  const result = { id: id(value.id, '附件标识'), type: choice(value.type, ['image', 'audio'], '附件类型'), mime: str(value.mime, '附件格式', 100, 1), name: str(value.name, '附件名称', 255, 1), url: str(value.url, '附件地址', 200, 1), bytes: integer(value.bytes, '附件大小', 1, 20 * 1024 * 1024) };
  const allowed = result.type === 'image' ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] : ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'];
  if (!allowed.includes(result.mime) || result.url !== `lingyu-media://asset/${result.id}`) throw new Error('附件地址或格式无效');
  return result;
}
function attachments(value = []) { if (!Array.isArray(value) || value.length > 4) throw new Error('每条消息最多 4 个附件'); const result = value.map(attachment); if (result.reduce((n, x) => n + x.bytes, 0) > 24 * 1024 * 1024) throw new Error('附件总大小超过限制'); return result; }
function date(value) { str(value, '时间', 40, 1); if (!Number.isFinite(Date.parse(value))) throw new Error('时间无效'); return new Date(value).toISOString(); }
function greeting(value) { object(value, '问候设置'); return {enabled: bool(value.enabled, '主动问候'), hour: integer(value.hour, '问候时间', 0, 23), mode: choice(value.mode ?? 'daily', ['daily','natural'], '问候节奏')}; }
function agent(value) {
  object(value, '角色');
  const result = {id: id(value.id), name: str(value.name, '角色名称', 80, 1), subtitle: str(value.subtitle ?? '', '简介', 300), avatar: str(value.avatar ?? '', '头像', 200), accent: str(value.accent ?? '#5267d8', '颜色', 20), persona: str(value.persona ?? '', '角色设定', 12000), memory: str(value.memory ?? '', '私有记忆', 12000), providerId: value.providerId ? id(value.providerId) : '', greeting: greeting(value.greeting ?? {enabled:false,hour:10}), voice: str(value.voice ?? '', '声音', 200), tags: []};
  if (!/^#[a-fA-F0-9]{6}$/.test(result.accent)) throw new Error('角色颜色无效');
  if (result.avatar && !/^assets\/(?:stickers\/)?[a-zA-Z0-9_-]+\.(svg|png|jpg|webp)$/.test(result.avatar) && !/^lingyu-media:\/\/asset\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result.avatar)) throw new Error('头像须为本应用素材或已导入的图片');
  if (!Array.isArray(value.tags ?? []) || (value.tags ?? []).length > 12) throw new Error('标签过多');
  result.tags = (value.tags ?? []).map(x => str(x, '标签', 30, 1));
  return result;
}
function message(value) {
  object(value, '消息');
  const result = {id: id(value.id), role: choice(value.role, ['user','assistant','peer','system'], '消息角色'), text: str(value.text ?? '', '消息正文', 200000), attachments: attachments(value.attachments), status: choice(value.status ?? 'sent', ['sent','pending','failed','cancelled'], '消息状态'), source: choice(value.source ?? 'local', ['ai','user','peer','local'], '消息来源'), createdAt: date(value.createdAt ?? new Date().toISOString())};
  if (value.model !== undefined) result.model = str(value.model, '模型', 200);
  if (value.replyTo !== undefined) result.replyTo = id(value.replyTo, '引用消息');
  if (value.greeting !== undefined) result.greeting = bool(value.greeting, '问候消息');
  return result;
}
class ChatStore {
  constructor({dir, encrypt, decrypt,managedOrigin=networkDefaults.signalingServerUrl} = {}) {
    if (typeof dir !== 'string' || !dir || typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new Error('需要存储目录与系统密钥加密服务');
    this.dir = path.resolve(dir); this.encrypt = encrypt; this.decrypt = decrypt; this.sequence = 0;this.managedBase=endpoint(managedOrigin)+'/v1/managed';
    fs.mkdirSync(this.dir, {recursive:true});
    this.state = {schema:1,providers:[{id:'atlas',name:'AtlasCloud',baseUrl:'https://api.atlascloud.ai/v1',model:'deepseek-ai/deepseek-v4.1-flash',vision:false,consent:false,encryptedApiKey:''}],agents:clone(defaults),conversations:[],messages:{},drafts:{},settings:{displayName:'我',autoVoice:false,theme:'light'},greetings:{}};
    const files = fs.readdirSync(this.dir).filter(x => /^snapshot-\d{16}-[a-f0-9]+\.json$/.test(x)).sort().reverse();
    let loaded = false;
    for (const file of files) { try { const parsed = JSON.parse(fs.readFileSync(path.join(this.dir,file),'utf8')); const serialized = JSON.stringify(parsed.state); if (parsed.schema !== 1 || !Number.isSafeInteger(parsed.sequence) || parsed.sequence < 1 || !file.startsWith(`snapshot-${String(parsed.sequence).padStart(16,'0')}-`) || crypto.createHash('sha256').update(serialized).digest('hex') !== parsed.sha256) continue; this.validateState(parsed.state); this.state = parsed.state; this.sequence = parsed.sequence; loaded = true; break; } catch {} }
    if (!loaded && files.length) throw new Error('没有可读取的有效聊天快照；请保留存储目录以便恢复');
    if (!loaded) this.persist(this.state);
    else if(Object.values(this.state.messages).some(list=>list.some(m=>m.status==='pending'))) this.change(state=>{for(const list of Object.values(state.messages))for(const m of list)if(m.status==='pending')m.status='failed';return true;});
    if(loaded){
      const upgrades=[];
      for(const a of this.state.agents){const old=legacyDefaults.find(x=>x.id===a.id),current=defaults.find(x=>x.id===a.id);if(!old||!current)continue;
        const patch={};for(const key of ['name','subtitle','persona','tags'])if(JSON.stringify(a[key])===JSON.stringify(old[key])&&JSON.stringify(a[key])!==JSON.stringify(current[key]))patch[key]=clone(current[key]);
        if(Object.keys(patch).length)upgrades.push({id:a.id,patch});
      }
      if(upgrades.length)this.change(state=>{for(const u of upgrades)Object.assign(state.agents.find(a=>a.id===u.id),u.patch);return true;});
    }
  }
  validateState(state) {
    object(state); if (state.schema !== 1 || !Array.isArray(state.providers) || !Array.isArray(state.agents) || !Array.isArray(state.conversations)) throw new Error('快照格式无效');
    if (state.providers.length > 100 || state.agents.length > 100 || state.conversations.length > 5000) throw new Error('快照超出限制');
    const unique = rows => { if (new Set(rows.map(x => x.id)).size !== rows.length) throw new Error('重复标识'); };
    for (const p of state.providers) { id(p.id); str(p.name,'服务名称',80,1); endpoint(p.baseUrl); str(p.model,'模型',200,1); bool(p.vision,'识图'); bool(p.consent,'授权'); str(p.encryptedApiKey,'加密密钥',20000); if (own(p,'apiKey')) throw new Error('禁止明文密钥');if(own(p,'managed')||p.id.startsWith('managed-')){if(p.managed!==true||p.id!=='managed-'+crypto.createHash('sha256').update(p.model).digest('hex').slice(0,24)||p.baseUrl!==this.managedBase||p.encryptedApiKey!=='')throw Error('托管服务资料无效，不能更改地址或夹带密钥');} }
    state.agents.forEach(agent); unique(state.providers); unique(state.agents); unique(state.conversations);
    const providers = new Set(state.providers.map(x=>x.id)); for (const a of state.agents) if (a.providerId && !providers.has(a.providerId)) throw new Error('服务不存在');
    object(state.messages); object(state.drafts); object(state.settings); object(state.greetings);
    const agents = new Set(state.agents.map(x=>x.id)); const conversations=new Set(state.conversations.map(c=>c.id));
    for(const [key,list] of Object.entries(state.messages)){id(key);if(!conversations.has(key)||!Array.isArray(list)||list.length>100000)throw new Error('消息会话或数量无效');}
    for (const c of state.conversations) { id(c.id); choice(c.type,['ai','peer'],'会话类型'); str(c.name,'会话名称',100,1); date(c.createdAt); date(c.updatedAt); bool(c.pinned,'置顶'); bool(c.archived,'归档'); bool(c.read,'已读'); if (c.type==='ai' && !agents.has(c.agentId)) throw new Error('角色不存在'); if (c.peerId) str(c.peerId,'对方标识',200,1); if (!Array.isArray(state.messages[c.id])) throw new Error('消息列表缺失'); state.messages[c.id].forEach(message); unique(state.messages[c.id]); }
    for (const [key,value] of Object.entries(state.drafts)) { if (!state.conversations.some(c=>c.id===key)) throw new Error('草稿会话不存在'); str(value,'草稿',20000); }
    this.settings(state.settings);
    for (const [key,value] of Object.entries(state.greetings)) { if (!agents.has(key) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('问候记录无效'); }
  }
  persist(state) {
    const sequence = Math.max(Date.now(), this.sequence + 1); const serialized = JSON.stringify(state);
    const entry = {schema:1,sequence,sha256:crypto.createHash('sha256').update(serialized).digest('hex'),state};
    const file = path.join(this.dir,`snapshot-${String(sequence).padStart(16,'0')}-${crypto.randomBytes(6).toString('hex')}.json`);
    const fd = fs.openSync(file,'wx',0o600); try { fs.writeFileSync(fd,JSON.stringify(entry),'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.sequence = sequence;
  }
  change(mutator) { const next = clone(this.state); const result = mutator(next); this.validateState(next); this.persist(next); this.state=next; return clone(result); }
  getPublic() { const result=clone(this.state); result.providers=result.providers.map(p=>({id:p.id,name:p.name,baseUrl:p.baseUrl,model:p.model,vision:p.vision,consent:p.consent,hasKey:!!p.encryptedApiKey,...(p.managed===true?{managed:true}:{})})); return result; }
  getProvider(providerId) { const p=this.state.providers.find(p=>p.id===providerId); if(!p) return null; const result={id:p.id,name:p.name,baseUrl:p.baseUrl,model:p.model,vision:p.vision,consent:p.consent};if(p.managed===true)return {...result,managed:true}; if(p.encryptedApiKey) { try { result.apiKey=this.decrypt(p.encryptedApiKey); str(result.apiKey,'解密密钥',10000,1); } catch { throw new Error('无法解密服务密钥，请在设置中重新保存'); } } else result.apiKey=''; return clone(result); }
  saveProvider(input) {
    object(input,'服务设置'); const providerId=input.id ? id(input.id) : crypto.randomUUID(); const old=this.state.providers.find(p=>p.id===providerId);
    if(own(input,'managed')||providerId.startsWith('managed-')||old?.managed)throw Error('托管伙伴请从一键连接里选择；自带密钥服务可以另建，原配置会保留。');
    const baseUrl=endpoint(input.baseUrl ?? old?.baseUrl); const p={id:providerId,name:str(input.name ?? old?.name ?? '自定义服务','服务名称',80,1),baseUrl,model:str(input.model ?? old?.model,'模型',200,1),vision:bool(input.vision ?? old?.vision ?? false,'识图'),consent:bool(input.consent ?? old?.consent ?? false,'发送授权'),encryptedApiKey:old && old.baseUrl===baseUrl ? old.encryptedApiKey : ''};
    if (input.apiKey !== undefined) { const key=str(input.apiKey,'密钥',10000).trim(); if(/[\r\n\t]/.test(key))throw new Error('密钥不得包含换行或制表符'); if (key) { try { p.encryptedApiKey=this.encrypt(key); str(p.encryptedApiKey,'加密密钥',20000,1); if (p.encryptedApiKey===key) throw new Error('明文'); } catch { throw new Error('系统密钥加密失败；设置未保存'); } } }
    this.change(state=>{const i=state.providers.findIndex(x=>x.id===providerId); if(i<0) state.providers.push(p); else state.providers[i]=p; return p;}); return this.getPublic().providers.find(x=>x.id===providerId);
  }
  bindManagedProvider(input){
    object(input,'托管服务');if(Object.keys(input).some(k=>!['agentId','model','name','vision','consent'].includes(k))||input.consent!==true)throw Error('请先确认托管聊天的数据发送范围');const agentId=id(input.agentId);if(!this.state.agents.some(a=>a.id===agentId))throw Error('角色不存在');const model=str(input.model,'模型',200,1);const p={id:'managed-'+crypto.createHash('sha256').update(model).digest('hex').slice(0,24),name:str(input.name,'托管服务名',80,1),baseUrl:this.managedBase,model,vision:bool(input.vision,'识图'),consent:true,managed:true,encryptedApiKey:''};
    this.change(s=>{const index=s.providers.findIndex(x=>x.id===p.id);if(index>=0)s.providers[index]=p;else s.providers.push(p);s.agents.find(a=>a.id===agentId).providerId=p.id;return true;});return {provider:this.getPublic().providers.find(x=>x.id===p.id),agent:clone(this.state.agents.find(a=>a.id===agentId))};
  }
  saveAgent(input) { object(input,'角色设置'); const agentId=input.id ? id(input.id) : crypto.randomUUID(); const old=this.state.agents.find(a=>a.id===agentId); const result=agent({...old,...input,id:agentId}); return this.change(s=>{const i=s.agents.findIndex(a=>a.id===agentId); if(i<0)s.agents.push(result);else s.agents[i]=result;return result;}); }
  exportAgent(agentId) { const found=this.state.agents.find(a=>a.id===agentId); if(!found) throw new Error('角色不存在'); const {providerId,memory,greeting:privateSchedule,...card}=clone(found); return {format:'lingyu-agent',version:1,...card}; }
  importAgent(card) { object(card,'角色卡'); if(card.format!==undefined && card.format!=='lingyu-agent') throw new Error('角色卡格式无效'); if(card.version!==undefined && card.version!==1)throw new Error('角色卡版本不支持'); const allowed={}; for(const key of ['name','subtitle','avatar','accent','persona','voice','tags']) if(own(card,key))allowed[key]=card[key]; return this.saveAgent({...allowed,id:crypto.randomUUID(),providerId:'',memory:'',greeting:{enabled:false,hour:10}}); }
  settings(input) { object(input,'设置'); const result={}; if(own(input,'displayName')) result.displayName=str(input.displayName,'显示名称',80,1); if(own(input,'autoVoice'))result.autoVoice=bool(input.autoVoice,'自动朗读'); if(own(input,'theme')) result.theme=choice(input.theme,['light','dark'],'主题'); if(own(input,'proactive')) {object(input.proactive,'问候偏好'); if(Object.keys(input.proactive).some(k=>k!=='background'))throw Error('问候偏好包含未知字段'); result.proactive={background:bool(input.proactive.background,'后台问候')};} if(own(input,'quietHours')) {object(input.quietHours,'免打扰');result.quietHours={enabled:bool(input.quietHours.enabled,'免打扰'),start:integer(input.quietHours.start,'开始小时',0,23),end:integer(input.quietHours.end,'结束小时',0,23)};} return result; }
  updateSettings(input) { const value=this.settings(input); return this.change(s=>{Object.assign(s.settings,value);return s.settings;}); }
  createConversation(input) {object(input,'会话'); const type=choice(input.type ?? 'ai',['ai','peer'],'会话类型'); const a=this.state.agents.find(a=>a.id===input.agentId); if(type==='ai'&&!a)throw new Error('角色不存在'); const now=new Date().toISOString(); const c={id:crypto.randomUUID(),type,agentId:type==='ai'?a.id:'',name:str(input.name ?? (a?.name || '真人会话'),'会话名称',100,1),pinned:false,archived:false,read:true,createdAt:now,updatedAt:now};if(input.peerId)c.peerId=str(input.peerId,'对方标识',200,1);if(type==='peer'&&/^friend:[a-f0-9]{32}$/.test(c.peerId||'')){const existing=this.state.conversations.find(item=>item.type==='peer'&&item.peerId===c.peerId);if(existing)return clone(existing);}return this.change(s=>{s.conversations.push(c);s.messages[c.id]=[];return c;}); }
  getConversation(conversationId) { const found=this.state.conversations.find(c=>c.id===conversationId); return found?clone(found):null; }
  setConversation(input) { object(input,'会话');id(input.id);return this.change(s=>{const c=s.conversations.find(c=>c.id===input.id);if(!c)throw new Error('会话不存在');for(const key of ['pinned','archived','read'])if(own(input,key))c[key]=bool(input[key],key);return c;}); }
  saveDraft(input) {object(input,'草稿');id(input.conversationId);str(input.text,'草稿',20000);return this.change(s=>{if(!s.messages[input.conversationId])throw new Error('会话不存在');s.drafts[input.conversationId]=input.text;return {conversationId:input.conversationId,text:input.text};}); }
  getMessages(conversationId) { if(!own(this.state.messages,conversationId))throw new Error('会话不存在');return clone(this.state.messages[conversationId]); }
  addMessage(conversationId,input) { object(input,'消息');id(conversationId);const result=message({...input,id:input.id ?? crypto.randomUUID()});return this.change(s=>{const c=s.conversations.find(c=>c.id===conversationId);if(!c)throw new Error('会话不存在');const list=s.messages[conversationId];if(list.some(m=>m.id===result.id))throw new Error('消息标识重复');if(result.replyTo&&!list.some(m=>m.id===result.replyTo))throw new Error('引用消息不存在');list.push(result);c.updatedAt=result.createdAt;if(['assistant','peer'].includes(result.role))c.read=false;return result;}); }
  patchMessage(conversationId,messageId,patch) {object(patch,'消息更新');id(conversationId);id(messageId);const allowed={};for(const k of ['text','attachments','status','model'])if(own(patch,k))allowed[k]=patch[k];return this.change(s=>{const list=s.messages[conversationId];if(!list)throw new Error('会话不存在');const i=list.findIndex(m=>m.id===messageId);if(i<0)throw new Error('消息不存在');list[i]=message({...list[i],...allowed});return list[i];}); }
  markGreeting(agentId,day) {id(agentId);str(day,'日期',10,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day)))throw new Error('日期无效');return this.change(s=>{if(!s.agents.some(a=>a.id===agentId))throw new Error('角色不存在');s.greetings[agentId]=day;return {agentId,day};}); }
}
module.exports={ChatStore,validateAgent:agent,validateAttachments:attachments,validateText:(value)=>str(value,'消息正文',20000)};
