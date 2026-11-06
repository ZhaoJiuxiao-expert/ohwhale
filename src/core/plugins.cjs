'use strict';
// Native local modules only. This registry is not a third-party extension loader.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateAttachments:attachmentSchema}=require('./store.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const FEATURES=['memory','stickers','voice','diary','proactive','space'];
const CATALOG=[
  {id:'memory',name:'长期记忆',description:'用户明确确认后保存的角色私有参考信息；可查看、停用，仅用于本机私有会话。'},
  {id:'stickers',name:'表情与贴图',description:'应用内置表情与本机图片附件入口；不安装或下载第三方表情插件。'},
  {id:'voice',name:'语音交流',description:'应用的录音转写、语音消息与朗读入口；实际可用性依赖设备、系统声音与模型服务设置。'},
  {id:'diary',name:'角色日记',description:'按日期保存用户内容或明确生成的 AI 日记，保留来源；不会自动改写既有记录。'},
  {id:'proactive',name:'主动问候',description:'应用保持运行时检查角色问候计划；还需单独开启角色问候，并遵守免打扰设置。'},
  {id:'space',name:'本机空间',description:'只在本机保存动态、点赞与评论，AI 评论需显式生成；不登录、连接或操作 QQ 账号。'}
];
function object(value,label='数据') {if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error(`${label}格式无效`);return value;}
function keys(value,allowed,label='数据') {object(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error(`${label}包含不支持的字段`);}
function text(value,label,max,min=1) {if(typeof value!=='string'||value.length<min||value.length>max||value.includes('\0')||(min>0&&!value.trim()))throw new Error(`${label}须为 ${min}–${max} 字符文本`);return value;}
function identifier(value,label='标识') {text(value,label,100);if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)||['__proto__','prototype','constructor'].includes(value))throw new Error(`${label}无效`);return value;}
function boolean(value,label) {if(typeof value!=='boolean')throw new Error(`${label}须为开关值`);return value;}
function source(value,allowed) {if(!allowed.includes(value))throw new Error('内容来源无效');return value;}
function timestamp(value) {text(value,'记录时间',40);if(!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error('记录时间无效');return value;}
function day(value) {text(value,'日期',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00.000Z'))||new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)!==value)throw new Error('日期无效');return value;}
function today() {const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
function unique(rows,label) {const seen=new Set();for(const row of rows){if(seen.has(row.id))throw new Error(`${label}标识重复`);seen.add(row.id);}}
class PluginStore {
  constructor({dir,validateAgent,validateAttachments}={}) {
    if(typeof dir!=='string'||!dir||typeof validateAgent!=='function'||typeof validateAttachments!=='function')throw new Error('插件存储需要目录、角色与附件验证服务');
    this.dir=path.resolve(dir);this.validateAgent=validateAgent;this.validateAttachments=validateAttachments;this.sequence=0;
    fs.mkdirSync(this.dir,{recursive:true});
    this.state={schema:1,settings:Object.fromEntries(FEATURES.map(id=>[id,true])),memories:[],diary:[],posts:[],activity:{}};
    const files=fs.readdirSync(this.dir).filter(name=>/^plugins-\d{16}-[a-f0-9]+\.json$/.test(name)).sort().reverse();let loaded=false;
    for(const file of files) {
      try {
        const record=JSON.parse(fs.readFileSync(path.join(this.dir,file),'utf8'));
        keys(record,['schema','sequence','sha256','state'],'插件快照');
        if(record.schema!==1||!Number.isSafeInteger(record.sequence)||record.sequence<1||!file.startsWith(`plugins-${String(record.sequence).padStart(16,'0')}-`))continue;
        const hash=crypto.createHash('sha256').update(JSON.stringify(record.state)).digest('hex');if(hash!==record.sha256)continue;
        this.validateState(record.state);this.state=record.state;this.sequence=record.sequence;loaded=true;break;
      } catch {}
    }
    if(!loaded&&files.length)throw new Error('没有可读取的有效插件快照；请保留目录以便恢复');
    if(!loaded)this.persist(this.state);
  }
  agent(agentId) {identifier(agentId,'角色标识');const result=this.validateAgent(agentId);if(result&&typeof result.then==='function')throw new Error('角色验证服务必须同步执行');return agentId;}
  author(authorId) {if(authorId==='me')return authorId;return this.agent(authorId);}
  attachments(input) {
    const normalized=this.validateAttachments(attachmentSchema(input));
    if(normalized&&typeof normalized.then==='function')throw new Error('附件验证服务必须同步执行');
    if(!Array.isArray(normalized))throw new Error('附件验证服务未返回附件列表');
    return attachmentSchema(normalized);
  }
  enabled(id) {if(!this.state.settings[id])throw new Error('此本机功能已关闭，请先在插件设置中开启');}
  validateMemory(row) {
    keys(row,['id','agentId','text','pinned','createdAt','active','usedAt'],'记忆');identifier(row.id);this.agent(row.agentId);text(row.text,'记忆内容',1000);boolean(row.pinned,'固定记忆');timestamp(row.createdAt);boolean(row.active,'记忆启用');if(row.usedAt!==null)timestamp(row.usedAt);
  }
  validateDiary(row) {keys(row,['id','agentId','text','source','day','createdAt'],'日记');identifier(row.id);this.agent(row.agentId);text(row.text,'日记内容',10000);source(row.source,['user','ai','activity']);day(row.day);timestamp(row.createdAt);}
  validateComment(row) {keys(row,['id','authorId','text','source','createdAt'],'评论');identifier(row.id);this.author(row.authorId);text(row.text,'评论内容',2000);source(row.source,['user','ai']);timestamp(row.createdAt);}
  validatePost(row) {
    keys(row,['id','authorId','text','attachments','source','createdAt','liked','comments'],'动态');identifier(row.id);this.author(row.authorId);text(row.text,'动态内容',10000,0);if(!Array.isArray(row.attachments))throw new Error('动态附件缺失');row.attachments.forEach(a=>keys(a,['id','type','mime','name','url','bytes'],'附件'));this.attachments(row.attachments);if(!row.text.trim()&&!row.attachments.length)throw new Error('动态不能为空');source(row.source,['user','ai']);timestamp(row.createdAt);boolean(row.liked,'点赞');if(!Array.isArray(row.comments)||row.comments.length>1000)throw new Error('评论数量超出限制');row.comments.forEach(c=>this.validateComment(c));unique(row.comments,'评论');
  }
  validateState(state) {
    keys(state,['schema','settings','memories','diary','posts','activity'],'插件状态');if(state.schema!==1)throw new Error('插件状态版本无效');
    keys(state.settings,FEATURES,'插件设置');for(const id of FEATURES)boolean(state.settings[id],'插件设置');
    for(const [name,max]of [['memories',20000],['diary',20000],['posts',10000]])if(!Array.isArray(state[name])||state[name].length>max)throw new Error('插件记录数量超出限制');
    state.memories.forEach(m=>this.validateMemory(m));state.diary.forEach(d=>this.validateDiary(d));state.posts.forEach(p=>this.validatePost(p));unique(state.memories,'记忆');unique(state.diary,'日记');unique(state.posts,'动态');
    const counts={};for(const row of state.memories)if(row.active){counts[row.agentId]=(counts[row.agentId]??0)+1;if(counts[row.agentId]>1000)throw new Error('单角色启用记忆最多 1000 条');}
    object(state.activity,'活动计数');for(const [agentId,countsByDay]of Object.entries(state.activity)){this.agent(agentId);object(countsByDay,'日期计数');if(Object.keys(countsByDay).length>36600)throw new Error('日期计数过多');for(const [date,count]of Object.entries(countsByDay)){day(date);if(!Number.isSafeInteger(count)||count<1||count>1000000)throw new Error('活动计数无效');}}
  }
  persist(state) {
    const sequence=Math.max(Date.now(),this.sequence+1);const serialized=JSON.stringify(state);const record={schema:1,sequence,sha256:crypto.createHash('sha256').update(serialized).digest('hex'),state};
    const file=path.join(this.dir,`plugins-${String(sequence).padStart(16,'0')}-${crypto.randomBytes(6).toString('hex')}.json`);const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(record),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}this.sequence=sequence;
  }
  change(mutator) {const next=clone(this.state);const result=mutator(next);this.validateState(next);this.persist(next);this.state=next;return clone(result);}
  getPublic() {const {settings,memories,diary,posts}=this.state;return clone({settings,memories,diary,posts,catalog:CATALOG.map(row=>({...row,status:'内置模块',native:true,enabled:settings[row.id]}))});}
  configure(input) {keys(input,['id','enabled'],'插件设置');if(!FEATURES.includes(input.id))throw new Error('未知本机插件');boolean(input.enabled,'启用插件');return this.change(state=>{state.settings[input.id]=input.enabled;return {id:input.id,enabled:input.enabled};});}
  remember(input) {
    keys(input,['agentId','text','pinned'],'记忆');this.enabled('memory');this.agent(input.agentId);text(input.text,'记忆内容',1000);const row={id:crypto.randomUUID(),agentId:input.agentId,text:input.text,pinned:input.pinned===undefined?false:boolean(input.pinned,'固定记忆'),createdAt:new Date().toISOString(),active:true,usedAt:null};return this.change(state=>{state.memories.push(row);return row;});
  }
  forgetMemory(input) {keys(input,['id'],'停用记忆');identifier(input.id);return this.change(state=>{const row=state.memories.find(m=>m.id===input.id);if(!row)throw new Error('记忆不存在');row.active=false;return row;});}
  contextForAgent(agentId) {
    this.agent(agentId);if(!this.state.settings.memory)return '';
    const candidates=this.state.memories.map((row,index)=>({row,index})).filter(({row})=>row.active&&row.agentId===agentId).sort((a,b)=>Number(b.row.pinned)-Number(a.row.pinned)||b.row.createdAt.localeCompare(a.row.createdAt)||b.index-a.index);
    const selected=[];let result='';for(const {row}of candidates){const line=`- ${JSON.stringify(row.text)}\n`;if(result.length+line.length>4000)continue;selected.push(row.id);result+=line;if(selected.length===8)break;}
    if(selected.length){const used=new Set(selected);this.change(state=>{const now=new Date().toISOString();for(const row of state.memories)if(used.has(row.id))row.usedAt=now;return true;});}
    return result.trimEnd();
  }
  addDiary(input) {keys(input,['agentId','text','source','day'],'日记');this.enabled('diary');this.agent(input.agentId);const row={id:crypto.randomUUID(),agentId:input.agentId,text:text(input.text,'日记内容',10000),source:source(input.source,['user','ai','activity']),day:day(input.day??today()),createdAt:new Date().toISOString()};return this.change(state=>{state.diary.push(row);return row;});}
  recordActivity(input) {keys(input,['agentId'],'活动');this.agent(input.agentId);if(!this.state.settings.diary)return {agentId:input.agentId,day:today(),count:0};return this.change(state=>{const date=today();if(!own(state.activity,input.agentId))state.activity[input.agentId]={};const count=(state.activity[input.agentId][date]??0)+1;state.activity[input.agentId][date]=count;return {agentId:input.agentId,day:date,count};});}
  addPost(input) {
    keys(input,['authorId','text','attachments','source'],'动态');this.enabled('space');this.author(input.authorId);const row={id:crypto.randomUUID(),authorId:input.authorId,text:text(input.text??'','动态内容',10000,0),attachments:this.attachments(input.attachments??[]),source:source(input.source,['user','ai']),createdAt:new Date().toISOString(),liked:false,comments:[]};if(!row.text.trim()&&!row.attachments.length)throw new Error('动态不能为空');return this.change(state=>{state.posts.push(row);return row;});
  }
  toggleLike(input) {keys(input,['postId'],'点赞');this.enabled('space');identifier(input.postId,'动态标识');return this.change(state=>{const post=state.posts.find(p=>p.id===input.postId);if(!post)throw new Error('动态不存在');post.liked=!post.liked;return post;});}
  addComment(input) {
    keys(input,['postId','authorId','text','source'],'评论');this.enabled('space');identifier(input.postId,'动态标识');this.author(input.authorId);const row={id:crypto.randomUUID(),authorId:input.authorId,text:text(input.text,'评论内容',2000),source:source(input.source,['user','ai']),createdAt:new Date().toISOString()};return this.change(state=>{const post=state.posts.find(p=>p.id===input.postId);if(!post)throw new Error('动态不存在');post.comments.push(row);return row;});
  }
}
module.exports={PluginStore};
