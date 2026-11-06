'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function configureDataLocation(app,{override=process.env.LINGYU_DATA_DIR}={}){
 const dir=override?path.resolve(override):path.join(app.getPath('documents'),'ai聊天软件');
 fs.mkdirSync(dir,{recursive:true});
 // Only copy legacy application-owned data into an empty profile, keeping every source.
 const legacy=path.join(app.getPath('appData'),'OhWhale');
 const planFile=path.join(dir,'migration-plan.json'),doneFile=path.join(dir,'migration.json');
 if(!override&&!fs.readdirSync(dir).length&&fs.existsSync(legacy)&&legacy!==dir){
  const selected=fs.readdirSync(legacy,{withFileTypes:true}).filter(x=>/^snapshot-\d{16}-[a-f0-9]+\.json$/.test(x.name)||['media','plugins','api-usage.jsonl'].includes(x.name));
  const files=[];function walk(relative){const src=path.join(legacy,relative),stat=fs.lstatSync(src);if(stat.isSymbolicLink())return;if(stat.isDirectory()){for(const child of fs.readdirSync(src))walk(path.join(relative,child));}else if(stat.isFile())files.push({relative,sha256:hash(src)});}
  for(const entry of selected)walk(entry.name);
  if(files.length)fs.writeFileSync(planFile,JSON.stringify({from:legacy,files},null,2),{flag:'wx'});
 }
 if(!override&&fs.existsSync(planFile)&&!fs.existsSync(doneFile)){
  const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));if(plan.from!==legacy||!Array.isArray(plan.files))throw Error('旧版数据迁移计划损坏，请保留数据目录检查');
  for(const item of plan.files){
   const src=path.resolve(legacy,item.relative),dest=path.resolve(dir,item.relative);
   if(!src.startsWith(legacy+path.sep)||!dest.startsWith(dir+path.sep)||fs.lstatSync(src).isSymbolicLink()||hash(src)!==item.sha256)throw Error('旧版数据迁移源已改变，迁移暂停；原数据仍保留');
   if(fs.existsSync(dest)){if(hash(dest)!==item.sha256)throw Error('旧版数据迁移尚未完成且目标文件冲突；未覆盖任何数据');continue;}
   fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(src,dest,fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(doneFile,JSON.stringify({at:new Date().toISOString(),from:legacy,files:plan.files.length,sourcePreserved:true},null,2),{flag:'wx'});
 }
 app.setPath('userData',dir);
 for(const [key,name]of [['sessionData','browser'],['crashDumps','crashes']]){const p=path.join(dir,name);fs.mkdirSync(p,{recursive:true});app.setPath(key,p);}
 app.setAppLogsPath(path.join(dir,'logs'));
 return dir;
}
module.exports={configureDataLocation};
