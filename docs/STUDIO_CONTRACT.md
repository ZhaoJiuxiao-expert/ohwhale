# 哦鲸鲸内容工作台 1.1

用户已确认：只做聊天角色/人设/表情/技能包编辑，不做游戏模组。旧1.0构建保留。真实用户数据改到 Electron app.getPath('documents')/ai聊天软件；测试 LINGYU_DATA_DIR 隔离。代码目录只有程序/默认可重建资源。知识库以本应用实际schema/代码为准，QQ安装资源仅只读参考，未获得完整源码。

## Ownership
Core agent: src/core/studio.cjs + tests/studio.test.cjs。
UI agent: src/ui/components/Studio.jsx + studio.css，App.jsx接入+顶部工具栏；scripts/studio-ui-qa.cjs。
Knowledge agent: src/core/knowledge.cjs、src/data/knowledge.json、src/data/studio-skills.json、tests/knowledge.test.cjs。
Root: main/preload、小说提取、AI编排、数据路径迁移、构建与整合。

## Entry schema
Project {id,name,schemaVersion:1,revision,createdAt,updatedAt,entries:[],extensions:{},warnings:[]}。未知根/条目字段归入extensions并提示，禁止静默丢弃。
Entry {id,type:'character'|'prompt'|'sticker'|'skill',codeName,displayNames:{zhCN,enUS?,...其他语言字符串},description,texture?:attachment|null,code:string,fields:object,extensions:object}。
code是JSON内容定义，不执行JS或shell。各类型的权威定义：
- character {persona:string,greeting?:string,tags?:string[]}。
- prompt {template:string,variables?:string[]}；校验引用的 {{变量}} 已声明。
- sticker {caption:string,tags:string[]}；激活发送前需要图像texture。
- skill {instruction:string,context:['currentEntry','project','knowledge'],output:'proposal'}；无任意文件/命令工具。
保留未知code字段并给warning，已知字段严格校验。texture只接受main验证的media descriptor，不接任意本机路径。可另有textureRef指向预置assets/路径。

## StudioStore
new StudioStore({dir,validateAttachment})，同步方法。每项目追加版本快照+hash，恢复最新有效版，不删除/覆盖旧版。
listProjects()=>[{id,name,revision,updatedAt,entryCount}]
createProject({name})=>project; getProject(id)=>project; renameProject({projectId,name})=>project
saveEntry({projectId,entry,expectedRevision?})=>project；新增/更新，乐观冲突拒绝
copyEntry({projectId,entryId})=>project；唯一id/codeName
validateEntry(entry)=>{valid,errors:[],warnings:[],normalizedEntry?}
importProject(data)=>newproject；保留未知和warning，允许带诊断的无效内容修复
exportProject(projectId)=>projectdata；拒绝无效结构，无app密钥/聊天
history(projectId)=>[{revision,at,label}]
rollback({projectId,revision,expectedRevision?})=>新增revision
prepareProposal({projectId,entryId,code,description?,explanation?})=>{id,projectId,entryId,baseRevision,before:{code,description},after:{code,description},diff:[{type:'same'|'add'|'remove',text}],validation:{valid,errors,warnings},impact:[],explanation}
applyProposal({projectId,proposalId})=>project；proposal仅服务端保存，检查revision/校验，未apply前不变更条目。AI仅替换目标JSON和描述，无任意文件patch。

## window.ly桥
studioList(); studioCreate({name}); studioOpen({projectId}); studioRename({projectId,name}); studioSaveEntry({projectId,entry,expectedRevision?}); studioCopyEntry({projectId,entryId}); studioValidate({entry}); studioHistory({projectId}); studioRollback({projectId,revision,expectedRevision?}); studioExport({projectId})=>{path}; studioImport()=>project|null；studioApply({projectId,proposalId}); studioActivate({projectId,entryId})=>{agent?}，角色发布到实际聊天且provider未绑定。studioSeed({projectId})复制8内置角色公开字段。
studioAsk({projectId,entryId,agentId,instruction,skillId?,consent:true})=>{proposal?,explanation,knowledge:[hits],mode:'proposal'|'explanation'}。选已配置角色只为确定模型；发当前条目+有界项目摘要+检索片段，不带私有聊天/记忆；提案必须显式应用。缺consent不出网。
knowledgeSearch({query,projectId?})=>{results:[{id,title,text,source,evidence,score}],count}; knowledgeRebuild()=>{count,at}; knowledgeStatus()=>{count,at,sources:[]}; studioSkills()=>[{id,name,instruction,context,output}].
studioImportNovel()=>{id,title,chars,chunks,preview,source}，原生TXT/MD/DOCX对话框，全文仅本机索引。
studioNovelPersona({projectId,novelId,characterName,agentId,consent:true})=>{entry,explanation,sources:[]}，仅草案，用户通过studioSaveEntry保存，不声称读取完整小说。真实发所选人物相关检索片段。

## KnowledgeStore
new KnowledgeStore({dir,defaultSources?,skills?})；默认require dataJSON。
rebuild()=>status; status(); search({query,limit=6,novelId?})=>{results,count}
importText({title,text,source})=>{id,title,chars,chunks,preview,source}
getNovel(id)=>{id,title,chars,chunks}; getText(id)可供内部受限提取
分段<=1800字符，overlap200，关键词检索，无网络/embedding。结果evidence为code-verified/official-source/local-static-evidence/user-upload。
默认知识：本app实际schema、IPC、媒体、模型、迁移、回滚，QQ证据注明静态边界；无虚构游戏规则。原文保留，索引可重建，所有写入dir下。
skills至少搜索知识、读条目、解释代码、修改建议、生成补丁、应用/回滚说明、结构校验、批量迁移预检、错误诊断；有操作的由主进程限制并显式应用，不把提示词称作任意执行权限。

## UI
全局顶端常用按钮：新建聊天、打开聊天、保存、导入、导出、设置；studio第三导航入口。工作台：项目选择/新建、左类别搜索新建复制、中央动态字段+图像+JSON编辑/校验、右AI输入模型/技能/检索结果。显示diff/影响/错误后Apply；历史回滚按钮。未知字段warning+extensions查看。导入/导出自身项目可往返。小说只读导入人物提取草案；无假AI回答。失败保留未保存内容。
