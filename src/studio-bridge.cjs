'use strict';
const fs=require('node:fs'),path=require('node:path');
function installStudioBridge({bind,studio,service,knowledge,dialog,win,exportJSON}){
 for(const [name,method]of Object.entries({studioCreate:'createProject',studioRename:'renameProject',studioSaveEntry:'saveEntry',studioCopyEntry:'copyEntry',studioRollback:'rollback',studioApply:'applyProposal'}))bind(name,input=>studio[method](input));
 bind('studioList',()=>studio.listProjects());
 bind('studioOpen',input=>studio.getProject(input?.projectId));
 bind('studioValidate',input=>studio.validateEntry(input?.entry));
 bind('studioHistory',input=>studio.history(input?.projectId));
 for(const [name,method]of Object.entries({studioSeed:'seed',studioActivate:'activate',studioAsk:'ask',studioNovelPersona:'novelPersona',studioDraftSave:'draftSave',studioDraftList:'draftList',studioDraftRemove:'draftRemove'}))bind(name,input=>service[method](input));
 bind('studioSkills',()=>service.skills());
 bind('knowledgeSearch',input=>knowledge.search({query:input?.query,limit:8}));
 bind('knowledgeRebuild',()=>knowledge.rebuild());
 bind('knowledgeStatus',()=>knowledge.status());
 bind('studioNovels',()=>knowledge.listNovels());
 bind('studioExport',input=>exportJSON('导出完整聊天内容包（含图片，不含聊天与密钥）','哦鲸鲸内容包-'+Date.now()+'.json',service.exportBundle(input?.projectId)));
 bind('studioImport',async()=>{
  const d=await dialog.showOpenDialog(win,{title:'打开聊天内容包',properties:['openFile'],filters:[{name:'哦鲸鲸内容包',extensions:['json']}]});if(d.canceled)return null;
  const f=d.filePaths[0];if(fs.statSync(f).size>50*1024*1024)throw Error('内容包最大50MB');
  return service.importBundle(JSON.parse(fs.readFileSync(f,'utf8')));
 });
 bind('studioImportNovel',async()=>{
  const d=await dialog.showOpenDialog(win,{title:'只读导入小说到本机知识库',properties:['openFile'],filters:[{name:'小说正文',extensions:['txt','md','docx']}]});if(d.canceled)return null;
  return service.importNovelFile(d.filePaths[0]);
 });
}
module.exports={installStudioBridge};
