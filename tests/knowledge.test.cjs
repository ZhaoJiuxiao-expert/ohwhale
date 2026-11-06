'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {KnowledgeStore}=require('../src/core/knowledge.cjs');
const fixture=extra=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lingyu-knowledge-'));return {dir,store:new KnowledgeStore({dir,...extra})};};

test('default knowledge separates actual studio code from QQ static evidence and official references',()=>{
 const {store}=fixture();const status=store.status();assert.ok(status.count>=24);assert.equal(status.novelCount,0);
 assert.deepEqual(new Set(status.sources.map(x=>x.evidence)),new Set(['code-verified','official-source','local-static-evidence']));
 for(const source of status.sources){if(source.evidence==='official-source')assert.match(source.source,/^https:\/\//);else assert.equal(fs.existsSync(source.source),true);}
 const schema=store.search({query:'角色 schema persona providerId'});assert.ok(schema.results.some(x=>x.id.startsWith('chat-schema:')));
 const proposal=store.search({query:'baseRevision expectedRevision applyProposal'});assert.ok(proposal.results.some(x=>x.id.startsWith('studio-proposal-contract:')&&x.evidence==='code-verified'));
 for(const file of ['studio.cjs','studio-service.cjs','data-location.cjs','harness.cjs','novel-text.cjs'])assert.ok(status.sources.some(x=>x.evidence==='code-verified'&&x.source.endsWith(path.sep+file)));
 const defaults=require('../src/data/knowledge.json');for(const id of ['studio-schema-contract','studio-proposal-contract','migration-contract','studio-bundle','studio-neutral-model','novel-source-preservation','novel-keyword-index']){const row=defaults.find(x=>x.id===id);assert.equal(row.evidence,'code-verified');assert.ok(row.verify.length>=2);}
 const qq=store.search({query:'QQ 静态 反编译'});assert.ok(qq.results.some(x=>x.id.startsWith('qq-static-boundary:')&&x.evidence==='local-static-evidence'));
 status.sources[0].count=999;assert.notEqual(store.status().sources[0].count,999);
});

test('rebuild appends index snapshots, validates source markers, and never changes original files',()=>{
 const {store,dir}=fixture();store.rebuild();const first=fs.readdirSync(path.join(dir,'indexes'))[0],before=fs.readFileSync(path.join(dir,'indexes',first));store.rebuild();assert.equal(fs.readdirSync(path.join(dir,'indexes')).length,2);assert.deepEqual(fs.readFileSync(path.join(dir,'indexes',first)),before);
 const next=new KnowledgeStore({dir});assert.equal(next.status().count,store.status().count);assert.equal(next.status().at,store.status().at);
 const src=path.join(dir,'verified-source.txt');fs.writeFileSync(src,'exists-marker');assert.throws(()=>new KnowledgeStore({dir:path.join(dir,'missing-marker'),defaultSources:[{id:'verified',title:'来源',text:'已有代码',source:src,evidence:'code-verified',verify:['missing-marker']}]}),/重新核验/);
 assert.throws(()=>new KnowledgeStore({dir:path.join(dir,'missing-source'),defaultSources:[{id:'missing',title:'缺失来源',text:'不能虚构代码',source:path.join(dir,'does-not-exist.cjs'),evidence:'code-verified'}]}),/不可核验/);
});

test('novel import preserves exact original text, creates bounded overlapping chunks and reloads offline',()=>{
 const {dir,store}=fixture({defaultSources:[]});const text='\ufeff第一章\r\n秦若寒把信封放在桌上。😀\n'+('秦若寒只相信证据，调查旧案。\r\n'.repeat(300))+'结尾原文  \r\n';
 const source=path.join(dir,'用户原小说.txt');fs.writeFileSync(source,text,'utf8');const original=fs.readFileSync(source);const novel=store.importText({title:'原文保留测试',text,source});
 assert.equal(novel.chars,text.length);assert.ok(novel.chunks>1);assert.ok(novel.preview.startsWith('\ufeff第一章'));assert.equal(store.getText(novel.id),text);assert.deepEqual(fs.readFileSync(source),original);
 const rows=store._docs.filter(x=>x.novelId===novel.id).sort((a,b)=>a.chunk-b.chunk);assert.equal(rows.length,novel.chunks);assert.equal(rows[0].start,0);assert.equal(rows.at(-1).end,text.length);
 for(let i=0;i<rows.length;i++){const row=rows[i];assert.ok(row.text.length<=1800);assert.equal(row.text,text.slice(row.start,row.end));assert.equal(row.evidence,'user-upload');assert.equal(row.source,source);if(i)assert.ok(rows[i-1].end-row.start>=200&&rows[i-1].end-row.start<=201);}
 const savedFiles=fs.readdirSync(path.join(dir,'originals'));const saved=fs.readFileSync(path.join(dir,'originals',savedFiles[0]));store.rebuild();assert.deepEqual(fs.readFileSync(path.join(dir,'originals',savedFiles[0])),saved);
 const again=new KnowledgeStore({dir,defaultSources:[]});assert.equal(again.getText(novel.id),text);assert.equal(again.getNovel(novel.id).chunks,novel.chunks);
 const hits=again.search({query:'秦若寒 信封 证据',novelId:novel.id,limit:3});assert.ok(hits.count>0);assert.ok(hits.results.length<=3);assert.ok(hits.results.every(x=>x.novelId===novel.id&&x.text.includes('秦若寒')));
});

test('keyword ranking is deterministic, filters novel IDs and returns no invented unmatched results',()=>{
 const {dir,store}=fixture({defaultSources:[]});const first=store.importText({title:'红叶故事',text:'红叶调查旧城失踪案，她谨慎记录证据。',source:path.join(dir,'红叶.txt')});const second=store.importText({title:'海边故事',text:'海风吹过空港，小舟还没有归来。',source:path.join(dir,'海边.txt')});
 const hits=store.search({query:'红叶 证据'});assert.equal(hits.results[0].novelId,first.id);assert.equal(store.search({query:'空港',novelId:first.id}).count,0);assert.equal(store.search({query:'空港',novelId:second.id}).count,1);
 assert.deepEqual(store.search({query:'完全不匹配xyz987'}),{results:[],count:0});assert.deepEqual(store.search({query:''}),{results:[],count:0});assert.deepEqual(store.search({query:'红叶 证据'}),hits);
 hits.results[0].text='changed';assert.notEqual(store.search({query:'红叶'}).results[0].text,'changed');
});

test('each upload appends a new original; source is metadata and never triggers file reads or network',()=>{
 const {dir,store}=fixture({defaultSources:[]});const previous=global.fetch;global.fetch=()=>{throw Error('must remain offline');};
 try{const a=store.importText({title:'相同标题',text:'用户亲自提供的小说文字。',source:'https://example.invalid/private-novel.txt'});const b=store.importText({title:'相同标题',text:'用户亲自提供的小说文字。',source:'https://example.invalid/private-novel.txt'});assert.notEqual(a.id,b.id);assert.equal(fs.readdirSync(path.join(dir,'originals')).length,2);assert.ok(store.search({query:'小说'}).results.every(x=>x.evidence==='user-upload'));assert.equal(store.getText(a.id),'用户亲自提供的小说文字。');}finally{global.fetch=previous;}
});

test('unusable index snapshots rebuild from originals; corrupt originals fail visibly without overwriting',()=>{
 const {dir,store}=fixture({defaultSources:[]});const row=store.importText({title:'恢复',text:'可以检索的可靠原文。',source:path.join(dir,'原小说.txt')});fs.writeFileSync(path.join(dir,'indexes','index-9999999999999-abcdef.json'),'{');assert.equal(new KnowledgeStore({dir,defaultSources:[]}).getText(row.id),'可以检索的可靠原文。');
 const original=path.join(dir,'originals',`novel-${row.id}.json`);fs.appendFileSync(original,'corrupt');const bytes=fs.readFileSync(original);assert.throws(()=>new KnowledgeStore({dir,defaultSources:[]}),/原文记录损坏/);assert.throws(()=>store.rebuild(),/原文记录损坏/);assert.deepEqual(fs.readFileSync(original),bytes);
});

test('schema, ID, control character, credentials and size limits reject dangerous or oversized input',()=>{
 const {dir,store}=fixture({defaultSources:[]});for(const value of ['../escape','C:\\outside','__proto__','constructor','',null]){assert.throws(()=>store.getText(value),/标识/);assert.throws(()=>store.getNovel(value),/标识/);}
 for(const text of ['', ' ', '\0bad', 'x'.repeat(5_000_001)])assert.throws(()=>store.importText({title:'小说',text,source:path.join(dir,'source.txt')}));
 assert.throws(()=>store.importText({title:'小说',text:'正文',source:'https://user:password@example.invalid/a'}),/凭据/);assert.throws(()=>store.importText({title:'小说',text:'正文',source:'bad\nsource'}),/控制字符/);
 assert.throws(()=>store.importText(JSON.parse('{"title":"小说","text":"正文","source":"input.txt","__proto__":{}}')),/不安全/);
 assert.throws(()=>store.search({query:'x',novelId:'../../escape'}),/标识/);assert.throws(()=>store.search({query:'x',limit:21}));assert.throws(()=>store.search({query:'x'.repeat(501)}));assert.equal(fs.readdirSync(path.join(dir,'originals')).length,0);
});

test('default skills cover bounded studio tasks, return clones, and reject execution output or unsafe context',()=>{
 const {store,dir}=fixture();const skills=store.getSkills();assert.ok(skills.length>=9);for(const skill of skills){assert.equal(skill.output,'proposal');assert.ok(skill.context.every(x=>['currentEntry','project','knowledge'].includes(x)));}
 for(const id of ['search-knowledge','read-entry','explain-code','suggest-change','generate-patch','validate-structure','rollback-plan','migration-preflight','diagnose-error'])assert.ok(skills.some(x=>x.id===id));
 skills[0].instruction='changed';assert.notEqual(store.skills[0].instruction,'changed');
 assert.throws(()=>new KnowledgeStore({dir:path.join(dir,'bad-skill'),skills:[{id:'exec',name:'非法',instruction:'执行',context:['filesystem'],output:'execute'}]}),/受限上下文/);
});
