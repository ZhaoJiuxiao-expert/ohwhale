const {contextBridge,ipcRenderer}=require('electron');
const methods=['bootstrap','saveProvider','saveAgent','createConversation','setConversation','updateSettings','saveDraft','send','cancel','importMedia','pasteImage','transcribe','speak','exportAgent','importAgent','exportHistory','copyText','recordPeer','recordPeerOutgoing','peerMedia','readMedia','setPeerShare','aiForPeer','shareStart','shareStop','shareStatus','pluginConfigure','remember','forgetMemory','addDiary','generateDiary','spacePost','spaceLike','spaceComment','spaceGenerate'];
let closeHandler=async()=>{};
methods.push('studioNovels');
methods.push('stopSpeech','saveRecording');
methods.push('friendsStatus','friendsEnable','friendsState','friendsRequest','friendsRespond','friendsBlock','friendsCall','friendsRespondCall','friendsSession','friendsEndCall');
methods.push('managedCatalog','managedUsage','managedConnect');
methods.push('studioList','studioCreate','studioOpen','studioRename','studioSaveEntry','studioCopyEntry','studioValidate','studioHistory','studioRollback','studioExport','studioImport','studioApply','studioActivate','studioSeed','studioAsk','knowledgeSearch','knowledgeRebuild','knowledgeStatus','studioSkills','studioImportNovel','studioNovelPersona','studioDraftSave','studioDraftList','studioDraftRemove');
ipcRenderer.on('ly:closing',async()=>{try{await closeHandler();await ipcRenderer.invoke('ly:closeReady',{ok:true});}catch{await ipcRenderer.invoke('ly:closeReady',{ok:false});}});
contextBridge.exposeInMainWorld('ly',{
 ...Object.fromEntries(methods.map(name=>[name,input=>ipcRenderer.invoke(`ly:${name}`,input)])),
 onEvent(callback){const handler=(_,event)=>callback(event);ipcRenderer.on('ly:event',handler);return()=>ipcRenderer.removeListener('ly:event',handler);},
 setCloseHandler(callback){if(typeof callback==='function')closeHandler=callback;}
});
