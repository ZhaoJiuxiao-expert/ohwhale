'use strict';
// Prepare and validate candidates only. Does not replace configuration or restart services.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const ORIGIN='47.86.23.218',APK='ohwhale-1.3.1.apk';
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function regular(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('Expected a regular non-symlink file: '+file);return st;}
function directory(file){const st=fs.lstatSync(file);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Expected a non-symlink directory: '+file);}
function caddyCandidate(input){
 if(!new RegExp('default_sni\\s+'+ORIGIN.replaceAll('.','\\.')+'(?:\\s|$)').test(input)||!input.includes('https://'+ORIGIN+' {')||input.includes('/downloads/'))throw Error('Unexpected Caddy HTTPS configuration; manual review required');
 const proxy='  reverse_proxy 127.0.0.1:8787';if(input.split(proxy).length!==2)throw Error('Expected exactly one existing reverse proxy');
 const replacement=`  route {\n    @apk path /downloads/${APK}\n    handle @apk {\n      root * /srv/public-downloads\n      rewrite * /${APK}\n      file_server\n    }\n    @downloads path /downloads /downloads/*\n    handle @downloads {\n      respond 404\n    }\n    handle {\n      reverse_proxy 127.0.0.1:8787\n    }\n  }`;
 return input.replace(proxy,replacement);
}
function composeCandidate(input){const needle='      - ./Caddyfile:/etc/caddy/Caddyfile:ro';if(input.split(needle).length!==2||input.includes('/srv/public-downloads'))throw Error('Unexpected compose config; manual review required');return input.replace(needle,needle+'\n      - ./public-downloads:/srv/public-downloads:ro');}
function prepare({dir,expectedHash,validate}){
 directory(dir);if(!/^[a-f0-9]{64}$/.test(expectedHash))throw Error('Expected lowercase SHA-256 of the verified APK');const pub=path.join(dir,'public-downloads');directory(pub);const apk=path.join(pub,APK),stat=regular(apk);if(!stat.size)throw Error('APK is empty');if(process.platform==='linux'&&(!(fs.statSync(pub).mode&0o001)||!(stat.mode&0o004)))throw Error('Public directory and APK must be readable by the Caddy container');if(sha(fs.readFileSync(apk))!==expectedHash)throw Error('APK hash mismatch; no candidate prepared');
 const names=['Caddyfile','Caddyfile.ip.https','compose.ip.yaml'];const originals={};for(const n of names){const f=path.join(dir,n);regular(f);originals[n]=fs.readFileSync(f,'utf8');}if(originals.Caddyfile!==originals['Caddyfile.ip.https'])throw Error('Active and renewal templates differ; do not overwrite either');
 const contents={'Caddyfile':caddyCandidate(originals.Caddyfile),'Caddyfile.ip.https':caddyCandidate(originals['Caddyfile.ip.https']),'compose.ip.yaml':composeCandidate(originals['compose.ip.yaml'])};
 const id=crypto.randomBytes(6).toString('hex'),backup=path.join(dir,'downloads-preparation-'+id);fs.mkdirSync(backup,{mode:0o700});
 for(const n of names){fs.writeFileSync(path.join(backup,n+'.original'),originals[n],{flag:'wx',mode:0o600});fs.writeFileSync(path.join(backup,n+'.candidate'),contents[n],{flag:'wx',mode:0o600});}
 // Validator receives candidate paths. Failure preserves backups/candidates and changes no live files.
 for(const n of ['Caddyfile','Caddyfile.ip.https'])validate(path.join(backup,n+'.candidate'));
 const manifest={version:1,apk:APK,apkSHA256:expectedHash,backup,caddyValidated:true,liveFilesModified:false,files:Object.fromEntries(names.map(n=>[n,{original:sha(originals[n]),candidate:sha(contents[n])}]))};fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});return manifest;
}
function dockerValidate(dir,file){const args=['run','--pull=never','--network=none','--entrypoint','caddy','--mount',`type=bind,src=${file},dst=/etc/caddy/Caddyfile,readonly`,'--mount',`type=bind,src=${path.join(dir,'runtime/acme')},dst=/certs,readonly`,'caddy:2','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'];const r=cp.spawnSync('docker',args,{encoding:'utf8',timeout:60000});if(r.error||r.status!==0)throw Error('Caddy candidate validation failed; no live files modified. '+String(r.stderr||'').slice(0,800));}
if(require.main===module){if(process.argv.length!==4||process.argv[2]!=='--prepare')throw Error('Usage: node enable-downloads-1.3.1.cjs --prepare <verified-apk-sha256>');if(process.platform!=='linux'||process.getuid()!==0)throw Error('Run as root on Linux');const dir='/opt/ohwhale-network';directory(path.join(dir,'runtime'));directory(path.join(dir,'runtime/acme'));const result=prepare({dir,expectedHash:process.argv[3],validate:file=>dockerValidate(dir,file)});console.log(JSON.stringify(result,null,2));console.log('Candidates only: live files untouched. Operator must compare source hashes, install all three candidates with original ownership/mode, validate compose, and explicitly recreate only Caddy. If any step fails restore all three .original files and recreate Caddy. Keep the managed compose override when invoking compose.');}
module.exports={prepare,caddyCandidate,composeCandidate};
