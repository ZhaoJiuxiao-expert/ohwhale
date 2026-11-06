'use strict';
// Offline, rebuildable keyword index. Uploaded originals are append-only.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const APP_ROOT=path.resolve(__dirname,'../..');
const DEFAULTS=path.join(__dirname,'../data/knowledge.json');
const SKILLS=path.join(__dirname,'../data/studio-skills.json');
const EVIDENCE=new Set(['code-verified','official-source','local-static-evidence','user-upload']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TEXT=5_000_000,MAX_TOTAL=20_000_000,MAX_RECORD=32*1024*1024;
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
function object(value,allowed,label){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error(`${label}格式无效`);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error(`${label}含未知或不安全字段`);}
function string(value,label,max,{empty=false}={}){if(typeof value!=='string'||value.length>max||value.includes('\0')||(!empty&&!value.trim()))throw Error(`${label}格式或长度无效`);return value;}
function identifier(value){if(typeof value!=='string'||!UUID.test(value))throw Error('小说标识无效');return value;}
function source(value){string(value,'来源',2048);if(/[\x00-\x1f\x7f]/.test(value))throw Error('来源包含控制字符');if(/^https?:/i.test(value)){const url=new URL(value);if(url.username||url.password)throw Error('来源不能包含凭据');}return value;}
function inside(root,target){const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function directory(root,name){const target=path.join(root,name);fs.mkdirSync(target,{recursive:true});if(!inside(root,fs.realpathSync(target)))throw Error('知识目录不能通过链接指向外部位置');return target;}
function appendFile(dir,name,value){const file=path.join(dir,name);const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return file;}
function readRecord(file){if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>MAX_RECORD)throw Error('知识记录类型或大小无效');return JSON.parse(fs.readFileSync(file,'utf8'));}
function pack(payload){return {payload,sha256:hash(JSON.stringify(payload))};}
function unpack(record){object(record,['payload','sha256'],'知识记录');if(record.sha256!==hash(JSON.stringify(record.payload)))throw Error('知识记录校验失败');return record.payload;}
function chunks(text){const result=[];for(let start=0;start<text.length;){let end=Math.min(start+1800,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;result.push({start,end,text:text.slice(start,end)});if(end===text.length)break;start=end-200;if(/[\uDC00-\uDFFF]/.test(text[start])&&/[\uD800-\uDBFF]/.test(text[start-1]))start--;}return result;}
function terms(query){const normalized=query.normalize('NFKC').toLowerCase(),result=new Set();for(const word of normalized.match(/[a-z0-9_]+|[\p{Script=Han}]+/gu)||[]){if(/^[a-z0-9_]+$/.test(word))result.add(word);else if(word.length===1){if(!'的了和与及是我你它'.includes(word))result.add(word);}else{if(word.length<=12)result.add(word);for(let i=0;i<word.length-1;i++){const token=word.slice(i,i+2);if(!['如何','怎么','什么','是否','一个','这个','以及','可以','需要'].includes(token))result.add(token);}}}return {normalized,tokens:[...result].slice(0,160)};}
class KnowledgeStore{
 constructor({dir,defaultSources,skills}={}){
  if(typeof dir!=='string'||!dir)throw Error('需要本机知识目录');fs.mkdirSync(dir,{recursive:true});this.dir=fs.realpathSync(path.resolve(dir));this.novelDir=directory(this.dir,'originals');this.indexDir=directory(this.dir,'indexes');
  if(defaultSources!==undefined&&!Array.isArray(defaultSources))throw Error('默认知识须为数组');if(skills!==undefined&&!Array.isArray(skills))throw Error('技能清单须为数组');
  this._defaultSources=defaultSources===undefined?null:clone(defaultSources);this._customSkills=skills===undefined?null:clone(skills);this._novels=new Map();this._docs=[];this._at=new Date().toISOString();
  this._novels=this._readNovels();
  this._checkTotal();this._skills=this._loadSkills();this._docs=this._buildIndex();
  // Index snapshots are expendable; authoritative originals are always rebuilt.
  for(const file of fs.readdirSync(this.indexDir).filter(name=>/^index-\d{13,16}-[0-9a-f]+\.json$/.test(name)).sort().reverse()){
   try{const snapshot=unpack(readRecord(path.join(this.indexDir,file)));if(snapshot.schema===1&&snapshot.fingerprint===this._fingerprint(this._docs)&&Number.isFinite(Date.parse(snapshot.at))){this._at=snapshot.at;break;}}catch{}
  }
 }
 _readNovels(){const novels=new Map();for(const file of fs.readdirSync(this.novelDir).filter(name=>/^novel-[0-9a-f-]{36}\.json$/.test(name)).sort()){try{const record=unpack(readRecord(path.join(this.novelDir,file)));this._validateNovel(record);if(file!==`novel-${record.id}.json`||novels.has(record.id))throw Error('小说记录标识冲突');novels.set(record.id,record);}catch{throw Error(`小说原文记录损坏，请保留原文件修复：${file}`);}}return novels;}
 _validateNovel(record){object(record,['schema','id','title','text','source','evidence','createdAt'],'小说原文');if(record.schema!==1||record.evidence!=='user-upload')throw Error('小说版本或来源无效');identifier(record.id);string(record.title,'小说标题',200);string(record.text,'小说原文',MAX_TEXT);source(record.source);if(typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt)))throw Error('小说记录时间无效');}
 _checkTotal(extra=0){let total=extra;for(const novel of this._novels.values())total+=novel.text.length;if(total>MAX_TOTAL||this._novels.size>100)throw Error('本机小说索引容量已达上限（总计2000万字符/100部）');}
 _loadSkills(){const values=this._customSkills??JSON.parse(fs.readFileSync(SKILLS,'utf8'));if(!Array.isArray(values)||values.length>100)throw Error('技能清单无效');const seen=new Set();return values.map(value=>{object(value,['id','name','instruction','context','output'],'技能');string(value.id,'技能标识',80);if(!/^[a-z][a-z0-9-]*$/.test(value.id)||seen.has(value.id))throw Error('技能标识重复或无效');seen.add(value.id);string(value.name,'技能名称',100);string(value.instruction,'技能说明',8000);if(!Array.isArray(value.context)||value.context.length>3||value.context.some(x=>!['currentEntry','project','knowledge'].includes(x))||new Set(value.context).size!==value.context.length||value.output!=='proposal')throw Error('技能只能使用受限上下文并输出提案');return clone(value);});}
 _buildIndex(){
  const defaults=this._defaultSources??JSON.parse(fs.readFileSync(DEFAULTS,'utf8'));if(!Array.isArray(defaults)||defaults.length>1000)throw Error('默认知识清单无效');const docs=[],seen=new Set();
  for(const value of defaults){object(value,['id','title','text','source','evidence','verify'],'默认知识');string(value.id,'知识标识',100);if(!/^[a-zA-Z0-9_-]+$/.test(value.id)||['__proto__','prototype','constructor'].includes(value.id)||seen.has(value.id))throw Error('知识标识重复或无效');seen.add(value.id);string(value.title,'知识标题',200);string(value.text,'知识正文',20000);source(value.source);if(!EVIDENCE.has(value.evidence)||value.evidence==='user-upload')throw Error('默认知识证据类型无效');
   let location=value.source,sourceHash;
   if(/^https:\/\//i.test(location)){if(value.evidence==='code-verified')throw Error('代码核验必须指向本机源码');}
   else{if(value.evidence==='official-source')throw Error('官方来源须为HTTPS URL');location=path.resolve(APP_ROOT,location);if(!fs.existsSync(location)||!fs.statSync(location).isFile()||fs.statSync(location).size>4*1024*1024)throw Error(`知识来源不可核验：${value.source}`);const raw=fs.readFileSync(location,'utf8');if(value.verify!==undefined&&(!Array.isArray(value.verify)||value.verify.length>30||value.verify.some(marker=>typeof marker!=='string'||marker.length>500||!raw.includes(marker))))throw Error(`知识来源标记已变化，请重新核验：${value.source}`);sourceHash=hash(raw);}
   chunks(value.text).forEach((chunk,index)=>docs.push({id:`${value.id}:${index}`,title:value.title,text:chunk.text,source:location,evidence:value.evidence,...(sourceHash?{sourceHash}:{}),start:chunk.start,end:chunk.end}));
  }
  for(const novel of this._novels.values()){const items=chunks(novel.text),sourceHash=hash(novel.text);items.forEach((chunk,index)=>docs.push({id:`${novel.id}:${index}`,novelId:novel.id,chunk:index,title:`${novel.title} · 片段 ${index+1}/${items.length}`,text:chunk.text,source:novel.source,evidence:'user-upload',start:chunk.start,end:chunk.end,sourceHash}));}
  return docs;
 }
 _fingerprint(docs){return hash(JSON.stringify(docs));}
 _status(docs=this._docs,at=this._at){const map=new Map();for(const doc of docs){const key=doc.evidence+'\0'+doc.source;const item=map.get(key)??{source:doc.source,evidence:doc.evidence,count:0};item.count++;map.set(key,item);}return {count:docs.length,at,sources:[...map.values()],novelCount:this._novels.size};}
 status(){return clone(this._status());}
 rebuild(){const previous=this._novels;this._novels=this._readNovels();try{this._checkTotal();const docs=this._buildIndex(),skills=this._loadSkills(),at=new Date().toISOString();const payload={schema:1,at,count:docs.length,fingerprint:this._fingerprint(docs),documents:docs};appendFile(this.indexDir,`index-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.json`,pack(payload));this._docs=docs;this._skills=skills;this._at=at;return this.status();}catch(error){this._novels=previous;throw error;}}
 get skills(){return clone(this._skills);}
 getSkills(){return this.skills;}
 search({query,limit=6,novelId}={}){
  string(query,'检索问题',500,{empty:true});if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('检索数量须为1至20');if(novelId!==undefined)identifier(novelId);const {normalized,tokens}=terms(query.trim());if(!tokens.length)return {results:[],count:0};const ranked=[];
  for(const doc of this._docs){if(novelId&&doc.novelId!==novelId)continue;const title=doc.title.normalize('NFKC').toLowerCase(),text=doc.text.normalize('NFKC').toLowerCase();let score=0,matched=0;for(const term of tokens){const inTitle=title.includes(term),inText=text.includes(term);if(inTitle||inText){matched++;score+=(inTitle?5:0)+(inText?2:0);}}if(!matched)continue;if(title.includes(normalized))score+=15;if(text.includes(normalized))score+=10;score+=matched/tokens.length*5;ranked.push({...doc,score:Math.round(score*100)/100});}
  ranked.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));return {results:clone(ranked.slice(0,limit)),count:ranked.length};
 }
 importText(input){
  object(input,['title','text','source'],'小说导入');string(input.title,'小说标题',200);string(input.text,'小说原文',MAX_TEXT);source(input.source);this._checkTotal(input.text.length);if(this._novels.size>=100)throw Error('最多导入100部小说');
  const record={schema:1,id:crypto.randomUUID(),title:input.title,text:input.text,source:input.source,evidence:'user-upload',createdAt:new Date().toISOString()};this._validateNovel(record);appendFile(this.novelDir,`novel-${record.id}.json`,pack(record));this._novels.set(record.id,record);
  try{this.rebuild();}catch(error){throw Error(`原文已追加保留（${record.id}），索引重建失败：${error.message}`);}
  return {...this.getNovel(record.id),preview:record.text.slice(0,240)};
 }
 getNovel(id){identifier(id);const record=this._novels.get(id);if(!record)throw Error('小说不存在');return {id:record.id,title:record.title,chars:record.text.length,chunks:chunks(record.text).length,source:record.source};}
 listNovels(){return [...this._novels.keys()].map(id=>({...this.getNovel(id),preview:this.getText(id).slice(0,240)}));}
 getText(id){identifier(id);const record=this._novels.get(id);if(!record)throw Error('小说不存在');return record.text;}
}
module.exports={KnowledgeStore};
