'use strict';
const fs=require('node:fs'),path=require('node:path');
function prepareFriendsData(dir){
 if(process.platform!=='linux'||process.getuid()!==0)throw Error('Prepare the friends bind directory as root on Linux');
 const runtime=path.join(path.resolve(dir),'runtime');if(!fs.existsSync(runtime))fs.mkdirSync(runtime,{mode:0o700});const parent=fs.lstatSync(runtime);if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o777)!==0o700)throw Error('Preserve existing runtime; expected root-owned 0700 directory');
 const target=path.join(runtime,'friends');if(fs.existsSync(target)){const existing=fs.lstatSync(target);if(!existing.isDirectory()||existing.isSymbolicLink()||existing.uid!==1000||existing.gid!==1000||(existing.mode&0o777)!==0o700)throw Error('Existing friends directory preserved; expected 1000:1000/0700');return {friendsDataReady:true,created:false};}
 fs.mkdirSync(target,{mode:0o700});fs.chownSync(target,1000,1000);return {friendsDataReady:true,created:true};
}
if(require.main===module){try{console.log(JSON.stringify(prepareFriendsData(process.cwd())));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={prepareFriendsData};
