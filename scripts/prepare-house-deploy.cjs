'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts','house-deploy-'+Date.now()),name='ohwhale-house-1.6',target=path.join(out,name);
const mapping=['server/signaling.cjs','server/terms.html','server/Dockerfile','server/managed-ai.cjs'].map(p=>[p,p]);mapping.push(['server/deploy/update-house-1.6.sh','update-house-1.6.sh']);
const files=[];for(const [source,dest]of mapping){const bytes=fs.readFileSync(path.join(root,source)),file=path.join(target,dest);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});files.push({file:dest,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({version:'1.6.0',files},null,2),{flag:'wx'});
const archive=out+'.tar.gz';cp.execFileSync('tar',['-czf',archive,'-C',out,name]);
console.log(JSON.stringify({archive,files:files.length,sha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),noCredentials:true}));
