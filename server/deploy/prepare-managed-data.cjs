'use strict';
const fs=require('node:fs'),path=require('node:path');
function prepareManagedData(dir){
 if(process.platform!=='linux'||process.getuid()!==0)throw Error('Prepare managed data as root on Linux');
 const runtime=path.join(path.resolve(dir),'runtime'),parent=fs.lstatSync(runtime);if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o777)!==0o700)throw Error('Expected root-owned private runtime');
 const target=path.join(runtime,'managed-ai');if(fs.existsSync(target)){const s=fs.lstatSync(target);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==1000||s.gid!==1000||(s.mode&0o777)!==0o700)throw Error('Existing managed directory preserved; expected 1000:1000/0700');return {ready:true,created:false};}fs.mkdirSync(target,{mode:0o700});fs.chownSync(target,1000,1000);return {ready:true,created:true};
}
if(require.main===module){try{console.log(JSON.stringify(prepareManagedData(process.cwd())));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={prepareManagedData};
