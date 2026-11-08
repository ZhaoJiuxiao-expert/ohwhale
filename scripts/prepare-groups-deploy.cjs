'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts','groups-deploy-'+Date.now());
const files=['server/signaling.cjs','server/groups.cjs','server/moments.cjs','server/friends.cjs','server/managed-ai.cjs','server/managed-models.json','server/check.html','server/check.js','server/Dockerfile','src/p2p/network.js','src/p2p/peer.js'];
const mapping=[...files.map(file=>[file,file]),['server/deploy/compose.groups.yaml','compose.groups.yaml'],['server/deploy/update-groups-1.5.sh','update-groups-1.5.sh'],['docs/groups-v1-contract.md','groups-v1-contract.md'],['docs/moments-v1-contract.md','moments-v1-contract.md']];
fs.mkdirSync(out,{recursive:true});const manifest=[];
for(const [src,dest]of mapping){const input=path.join(root,src),target=path.join(out,dest);if(!fs.statSync(input).isFile())throw Error('Missing deployment input: '+src);fs.mkdirSync(path.dirname(target),{recursive:true});const bytes=fs.readFileSync(input);fs.writeFileSync(target,bytes,{flag:'wx',mode:dest.endsWith('.sh')?0o700:0o600});manifest.push({file:dest,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({version:'1.5.0',files:manifest},null,2),{flag:'wx'});
console.log(JSON.stringify({directory:out,files:manifest.length,noCredentials:true}));
