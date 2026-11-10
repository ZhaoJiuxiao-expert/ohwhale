const fs=require('node:fs'),path=require('node:path');
async function main(){
 const {packager}=await import('@electron/packager');const root=path.resolve(__dirname,'..');
 const stamp=Date.now(),stage=path.join(root,'artifacts',`stage-${stamp}`),out=path.join(root,'release',`build-${stamp}`);fs.mkdirSync(stage,{recursive:true});
 fs.cpSync(path.join(root,'src'),path.join(stage,'src'),{recursive:true});
 const pkg=require('../package.json');fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,productName:pkg.productName,version:pkg.version,description:pkg.description,author:pkg.author,main:pkg.main},null,2));
 for(const file of ['README.md','THIRD_PARTY_NOTICES.md'])if(fs.existsSync(path.join(root,file)))fs.copyFileSync(path.join(root,file),path.join(stage,file));
 if(fs.existsSync(path.join(root,'licenses')))fs.cpSync(path.join(root,'licenses'),path.join(stage,'licenses'),{recursive:true});
 if(fs.existsSync(path.join(root,'docs')))fs.cpSync(path.join(root,'docs'),path.join(stage,'docs'),{recursive:true});
 const dirs=await packager({dir:stage,name:'OhWhale',platform:'win32',arch:'x64',out,overwrite:false,asar:{unpack:'**/speech.ps1'},prune:false,electronVersion:require('electron/package.json').version,...(process.env.ELECTRON_ZIP_DIR ? {electronZipDir:path.resolve(process.env.ELECTRON_ZIP_DIR)} : {}),icon:path.join(root,'src/ui/app.ico'),appCopyright:'赵子旭 · 哦鲸鲸；第三方素材见来源说明',win32metadata:{FileDescription:'哦鲸鲸',ProductName:'哦鲸鲸',InternalName:'OhWhale',CompanyName:''}});
 for(const dir of dirs){
  for(const file of ['README.md','THIRD_PARTY_NOTICES.md'])if(fs.existsSync(path.join(root,file)))fs.copyFileSync(path.join(root,file),path.join(dir,file),fs.constants.COPYFILE_EXCL);
  if(fs.existsSync(path.join(root,'docs')))fs.cpSync(path.join(root,'docs'),path.join(dir,'说明与研究记录'),{recursive:true,errorOnExist:true,force:false});
  fs.writeFileSync(path.join(dir,'开始使用.txt'),`哦鲸鲸 ${pkg.version}\n\n双击 OhWhale.exe，小鲸就在这里。请把整个文件夹留在一起，不要只复制 EXE 呀。\n\n第一次使用：打开即到聊天列表。点击群聊，进入宿舍、旅行或游戏房间；查看 DeepSeek、千问、Kimi、豆包的连接建议，确认发送范围后可一起连接，不必逐一手填密钥。已有连接会保留；托管服务暂不可用时，也可在更多设置里使用自己的 API。实际模型以确认页为准。\n不添加好友，也能和三位 AI 进入宿舍、旅行或小游戏房间。发消息前选择伙伴并明确发送；小游戏规则在本机运行。\n想带来自己的小屋：在房间中打开布置小屋，导入标准 GLB 或全部资源内嵌的 glTF 2.0。你来选择哪些物件让伙伴知道。\n想捏一位新伙伴：进入“我” → “小工坊”。\n手机里的设置、导入和导出，也可以从右上角“＋”找到。\n\n旧版正在运行时，请先正常关闭旧窗口，再打开新版，草稿会保存在本机。\n聊天、场景和密钥保存在设置显示的本机数据位置；软件包不附用户密钥。\n聊天布局与入口请看 chat-layout-1.7.md；小屋操作请看“说明与研究记录”里的 house-1.6.md；帮助与约定：https://47.86.23.218/terms。\n托管可用性与测试范围以交付包内带日期的验收记录为准，不以预置开场或合成回复代替真实模型验收。完整说明请看 README.md。\n`,{flag:'wx',encoding:'utf8'});
 }
 const record={dirs,version:pkg.version,at:new Date().toISOString()};fs.writeFileSync(path.join(root,'artifacts',`package-${stamp}.json`),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
