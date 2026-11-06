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
  fs.writeFileSync(path.join(dir,'开始使用.txt'),`哦鲸鲸 ${pkg.version}\n\n双击 OhWhale.exe，小鲸就在这里。请把整个文件夹留在一起，不要只复制 EXE 呀。\n\n第一次使用：设置 → 模型服务，连接你自己的 API。角色卡和模型可以分别选择。\n想捏一位新伙伴：进入“我” → “小工坊”。\n手机里的设置、导入和导出，也可以从右上角“＋”找到。\n\n旧版正在运行时，请先正常关闭旧窗口，再打开新版，草稿会保存在本机。\n聊天和密钥存放在系统文档里的 ai聊天软件 文件夹；软件包不附密钥。\n完整说明请看 README.md；测试范围以交付包内的验收结果为准。\n`,{flag:'wx',encoding:'utf8'});
 }
 const record={dirs,version:pkg.version,at:new Date().toISOString()};fs.writeFileSync(path.join(root,'artifacts',`package-${stamp}.json`),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
