'use strict';
const fs=require('node:fs'),path=require('node:path');
function privateConfig(dir,{uid=process.getuid?.(),stat=fs.lstatSync}={}){
 if(uid!==0)throw Error('Run configuration and deployment as root; secret files remain root-owned 0600');
 const folder=stat(dir);if(!folder.isDirectory()||folder.isSymbolicLink()||folder.uid!==0||(folder.mode&0o022)!==0)throw Error('Deployment directory must be root-owned, not a symlink and not group/world writable');
 for(const name of ['secrets.env','turnserver.conf','Caddyfile','network-deployment.json']){const s=stat(path.join(dir,name));if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o777)!==0o600)throw Error('Private configuration must be regular root:root 0600 files: '+name);}
 try{const s=stat(path.join(dir,'Caddyfile.ip.https'));if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o777)!==0o600)throw Error('IP HTTPS template must be a regular root:root 0600 file');}catch(error){if(error.code!=='ENOENT')throw error;}
 const runtime=path.join(dir,'runtime');let s;try{s=stat(runtime);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(s&&(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o777)!==0o700))throw Error('runtime must be a private root-owned 0700 directory');
 return {privateConfigVerified:true};
}
if(require.main===module){try{if(process.platform!=='linux')throw Error('Run ownership preflight on the Linux server');console.log(JSON.stringify(privateConfig(process.cwd())));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={privateConfig};
