const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {extractNovel,crc32}=require('../src/core/novel-text.cjs');
const {configureDataLocation}=require('../src/core/data-location.cjs');
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-studio-'));
function zipXml(xml){const raw=Buffer.from(xml),packed=zlib.deflateRawSync(raw),name=Buffer.from('word/document.xml'),local=Buffer.alloc(30+name.length),central=Buffer.alloc(46+name.length),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);name.copy(local,30);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(crc32(raw),16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);name.copy(central,46);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(local.length+packed.length,16);return Buffer.concat([local,packed,central,end]);}
test('DOCX paragraphs/runs/entities and UTF text decode without external applications',()=>{
 const b=zipXml('<w:document><w:p><w:r><w:t>小</w:t></w:r><w:r><w:t>鱼&amp;月光&#x1f41f;</w:t></w:r></w:p><w:p><w:t>第二行</w:t><w:tab/><w:t>原样</w:t></w:p></w:document>');
 assert.equal(extractNovel(b,'.docx'),'小鱼&月光🐟\n第二行\t原样');assert.equal(extractNovel(Buffer.from('正文\r\n第二段'),'.txt'),'正文\n第二段');
 assert.equal(extractNovel(Buffer.concat([Buffer.from([255,254]),Buffer.from('中文','utf16le')]),'.txt'),'中文');
 assert.throws(()=>extractNovel(Buffer.from([0xff,0x00]),'.txt'));
 assert.throws(()=>extractNovel(zipXml('<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///x">]><w:p><w:t>&bad;</w:t></w:p>'),'.docx'));
 const damaged=Buffer.from(b);damaged[40]^=255;assert.throws(()=>extractNovel(damaged,'.docx'));
});
test('all runtime roots use documents; legacy copied once without deleting source',()=>{
 const root=dir(),docs=path.join(root,'Documents'),appData=path.join(root,'AppData');fs.mkdirSync(path.join(appData,'OhWhale','media'),{recursive:true});fs.writeFileSync(path.join(appData,'OhWhale','snapshot-0000000000000001-abcd.json'),'source');fs.writeFileSync(path.join(appData,'OhWhale','media','test'),'image');fs.writeFileSync(path.join(appData,'OhWhale','unrelated-secret'),'never copy');
 const values={documents:docs,appData};const app={getPath:n=>values[n],setPath:(k,v)=>values[k]=v,setAppLogsPath:p=>values.logs=p};
 const target=configureDataLocation(app,{override:''});assert.equal(target,path.join(docs,'ai聊天软件'));for(const k of ['userData','sessionData','crashDumps','logs'])assert(values[k].startsWith(target));
 assert(fs.existsSync(path.join(target,'media','test')));assert(!fs.existsSync(path.join(target,'unrelated-secret')));assert(fs.existsSync(path.join(appData,'OhWhale','media','test')));
 configureDataLocation(app,{override:''});assert.equal(fs.readFileSync(path.join(target,'snapshot-0000000000000001-abcd.json'),'utf8'),'source');
});
// These integration checks use a deterministic model stub, not claims about model quality.
test('studio orchestration isolates context, requires consent, stages valid proposals and guards stale edits',async()=>{
 const {StudioStore}=require('../src/core/studio.cjs'),{StudioService}=require('../src/core/studio-service.cjs');const root=dir(),studio=new StudioStore({dir:root,validateAttachment:a=>a});
 const p=studio.createProject({name:'测试'});const entry={id:'fixture',type:'character',codeName:'fixture',displayNames:{zhCN:'测试鱼'},description:'说明',code:JSON.stringify({persona:'原人设',tags:[],futureField:3}),fields:{},extensions:{secretUnused:'do-not-send'}};
 studio.saveEntry({projectId:p.id,entry});let sent='',calls=0,afterReply;
 const deps={dir:root,studio,store:{getPublic:()=>({agents:[]})},media:{},knowledge:{search:()=>({results:[{evidence:'user-upload',title:'PRIVATE_NOVEL',text:'PRIVATE_NOVEL'},{evidence:'code-verified',title:'schema',text:'character requires persona'}]})},harness:{replyStudio:async({text})=>{calls++;sent=text;afterReply?.();return {model:'mock',text:JSON.stringify({mode:'proposal',code:{persona:'修改后',tags:[],futureField:3},explanation:'解释'})};}}};
 const service=new StudioService(deps);await assert.rejects(service.ask({projectId:p.id,entryId:'fixture',instruction:'修改',agentId:'fish'}),/确认/);assert.equal(calls,0);
 const response=await service.ask({projectId:p.id,entryId:'fixture',instruction:'修改',agentId:'fish',consent:true});assert(!sent.includes('PRIVATE_NOVEL'));assert(!sent.includes('do-not-send'));assert(response.proposal.validation.valid);assert(studio.getProject(p.id).entries[0].code.includes('原人设'));
 studio.applyProposal({projectId:p.id,proposalId:response.proposal.id});assert(studio.getProject(p.id).entries[0].code.includes('修改后'));
 afterReply=()=>studio.renameProject({projectId:p.id,name:'期间修改'});await assert.rejects(service.ask({projectId:p.id,entryId:'fixture',instruction:'修改',agentId:'fish',consent:true}),/项目已改变/);
 service.draftSave({projectId:p.id,entry:{...entry,code:'{ invalid'}});service.draftRemove({projectId:p.id,entryId:entry.id});service.draftSave({projectId:p.id,entry:{...entry,code:'{ latest'}});
 const again=new StudioService(deps);assert.equal(again.draftList()[0].entry.code,'{ latest');
});
test('bundle carries remapped image and unknown attribution; original package and source bytes survive',()=>{
 const {StudioStore}=require('../src/core/studio.cjs'),{StudioService}=require('../src/core/studio-service.cjs'),{KnowledgeStore}=require('../src/core/knowledge.cjs');
 const root=dir(),mediaId='2cbd6495-82a5-4c69-a30d-b481972a4c81',image={id:mediaId,type:'image',mime:'image/png',name:'图.png',bytes:3,url:'lingyu-media://asset/'+mediaId};
 const media={fromData:a=>({...image,name:a.name}),validated:a=>a,resolve:()=>({dataUrl:'data:image/png;base64,YWJj',name:'图.png',type:'image'})};
 const studio=new StudioStore({dir:root,validateAttachment:a=>a}),knowledge=new KnowledgeStore({dir:root,defaultSources:[]});
 const service=new StudioService({dir:root,studio,knowledge,media,store:{},harness:{}});
 const data={format:'ohwhale-studio',version:1,project:{name:'图片包',entries:[{id:'sticker',type:'sticker',codeName:'meme',displayNames:{zhCN:'表情'},description:'',code:JSON.stringify({caption:'开饭',tags:[]}),fields:{},extensions:{},texture:{...image,id:'old'}}]},assets:[{entryId:'sticker',name:'图.png',type:'image',dataUrl:'data:image/png;base64,YWJj',attribution:'作者保留署名',future:42}],futurePackage:{v:2}};
 const p=service.importBundle(data);assert.equal(p.entries[0].texture.id,mediaId);assert.equal(p.entries[0].extensions.assetMetadata.attribution,'作者保留署名');assert.equal(p.extensions.packageFields.futurePackage.v,2);
 const bundle=service.exportBundle(p.id);assert.equal(bundle.assets[0].dataUrl,'data:image/png;base64,YWJj');assert.equal(bundle.project.entries[0].extensions.assetMetadata.future,42);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'studio-events','imports',fs.readdirSync(path.join(root,'studio-events','imports'))[0]),'utf8')).assets[0].attribution,'作者保留署名');
 const original=Buffer.concat([Buffer.from([239,187,191]),Buffer.from('月鲸\r\n喜欢月光。\r第二段')]),source=path.join(root,'original.txt');fs.writeFileSync(source,original);
 const imported=service.importNovelFile(source);assert(fs.readFileSync(imported.originalArchive).equals(original));assert(fs.readFileSync(source).equals(original));assert(knowledge.getText(imported.id).includes('\n'));
 const missing=studio.saveEntry({projectId:p.id,entry:{id:'broken',type:'sticker',codeName:'broken',displayNames:{zhCN:'缺图'},description:'',code:'{"caption":"","tags":[]}',textureRef:'assets/never-existed.png',fields:{},extensions:{}}});
 assert.throws(()=>service.activate({projectId:missing.id,entryId:'broken'}),/不存在/);
});
test('interrupted migration resumes planned files and leaves existing source intact',()=>{
 const crypto=require('node:crypto'),root=dir(),values={documents:path.join(root,'Documents'),appData:path.join(root,'AppData')},legacy=path.join(values.appData,'OhWhale'),target=path.join(values.documents,'ai聊天软件');fs.mkdirSync(legacy,{recursive:true});fs.mkdirSync(target,{recursive:true});
 fs.writeFileSync(path.join(legacy,'first'),'one');fs.writeFileSync(path.join(legacy,'second'),'two');fs.writeFileSync(path.join(target,'first'),'one');
 fs.writeFileSync(path.join(target,'migration-plan.json'),JSON.stringify({from:legacy,files:['first','second'].map(relative=>({relative,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(legacy,relative))).digest('hex')}))}));
 configureDataLocation({getPath:n=>values[n],setPath:(k,v)=>values[k]=v,setAppLogsPath:p=>values.logs=p},{override:''});
 assert.equal(fs.readFileSync(path.join(target,'second'),'utf8'),'two');assert(fs.existsSync(path.join(target,'migration.json')));assert(fs.existsSync(path.join(legacy,'second')));
});
