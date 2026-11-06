'use strict';
// Operator-invoked deployment tool. Preparing a bundle never invokes this file.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),https=require('node:https'),cp=require('node:child_process');
const {privateConfig}=require('./preflight.cjs');
const {prepareFriendsData}=require('./prepare-friends-data.cjs');
const CERT='ohwhale-ip',ROOT='/var/lib/ohwhale';
function configAt(dir){const value=JSON.parse(fs.readFileSync(path.join(dir,'network-deployment.json'),'utf8'));if(value.version!==1||value.mode!=='ip'||!net.isIPv4(value.publicIP)||value.signalHost!==value.publicIP)throw Error('Generate a fresh OH_HTTPS_MODE=ip configuration first');return value;}
function certbotVersion(output){const m=/certbot\s+(\d+)\.(\d+)\.(\d+)/.exec(output);if(!m||Number(m[1])<5||Number(m[1])===5&&Number(m[2])<4)throw Error('Certbot 5.4+ is required for IP webroot certificates');return m[0];}
function commands(action,config,{email,agree=false}={}){
 const compose=['compose','-f','compose.ip.yaml'],bot=[...compose,'run','--rm','--no-deps','certbot'];
 if(action==='bootstrap')return [[...compose,'up','-d','--build','signaling','caddy','turn']];
 if(['stage','issue'].includes(action)){
  if(!agree||typeof email!=='string'||email.length>254||!/^[-a-zA-Z0-9.!#$%&'*+/=?^_`{|}~]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email))throw Error('Set OH_ACME_EMAIL and explicitly pass --agree-tos after reviewing the CA terms');
  const area=action==='stage'?'acme-staging':'acme',sub=action==='stage'?'staging':'production';
  return [[...bot,'--version'],[...bot,'certonly','--non-interactive','--agree-tos','--email',email,'--cert-name',CERT,'--required-profile','shortlived','--webroot','--webroot-path',ROOT+'/challenges','--ip-address',config.publicIP,'--config-dir',ROOT+'/'+area,'--work-dir',ROOT+'/work/'+sub,'--logs-dir',ROOT+'/logs/'+sub,'--no-directory-hooks',...(action==='stage'?['--staging']:[])]];
 }
 if(['renew','renew-test'].includes(action))return [[...bot,'--version'],[...bot,'renew','--non-interactive','--cert-name',CERT,'--config-dir',ROOT+'/acme','--work-dir',ROOT+'/work/production','--logs-dir',ROOT+'/logs/production','--no-directory-hooks','--no-random-sleep-on-renew',...(action==='renew-test'?['--dry-run']:[])]];
 throw Error('Use bootstrap, stage, issue, renew, renew-test, status or units');
}
function certificate(dir,ip,now=Date.now()){
 const base=path.join(dir,'runtime/acme/live',CERT),cert=new crypto.X509Certificate(fs.readFileSync(path.join(base,'fullchain.pem'))),key=crypto.createPrivateKey(fs.readFileSync(path.join(base,'privkey.pem')));
 const from=Date.parse(cert.validFrom),until=Date.parse(cert.validTo);
 if(!cert.checkIP(ip)||!cert.checkPrivateKey(key)||!Number.isFinite(until)||from>now||until<=now||until-from>7*86400000)throw Error('Production certificate must match this IP/key and be a currently valid short-lived certificate');
 return {fingerprint:cert.fingerprint256,expiresAt:new Date(until).toISOString(),remainingHours:Math.round((until-now)/360000)/10};
}
async function trustedHealth(ip,fingerprint,transport=https){
 return new Promise((resolve,reject)=>{const req=transport.get({hostname:ip,path:'/health',port:443,rejectUnauthorized:true,timeout:15000},res=>{const actualFingerprint=res.socket?.getPeerCertificate().fingerprint256;let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy(Error('Unexpected HTTPS health response'));});res.on('end',()=>{try{if(res.statusCode!==200||actualFingerprint!==fingerprint||JSON.parse(body).ok!==true)throw Error('Trusted HTTPS health/certificate check failed');resolve();}catch(error){reject(error);}});res.on('error',reject);});req.on('timeout',()=>req.destroy(Error('Public HTTPS health check timed out')));req.on('error',reject);});
}
function units(dir){
 // WorkingDirectory is a literal path in systemd249, not shell argv. Quoting
 // it makes the initial quote part of the path and fails the absolute check.
 // Keep this bootstrap's reviewed target fixed; reject templates for any
 // other path rather than accepting whitespace/newline/specifier injection.
 if(dir!=='/opt/ohwhale-network')throw Error('Renewal units require the exact reviewed Linux directory /opt/ohwhale-network');
 return {
  'ohwhale-ip-renew.service':`[Unit]\nDescription=Renew OhWhale public IP certificate and verify HTTPS\nAfter=docker.service network-online.target\nRequires=docker.service\nWants=network-online.target\n\n[Service]\nType=oneshot\nUser=root\nUMask=0077\nWorkingDirectory=/opt/ohwhale-network\nExecStart=/usr/local/bin/node /opt/ohwhale-network/ip-https.cjs renew\nTimeoutStartSec=10min\n`,
  'ohwhale-ip-renew.timer':'[Unit]\nDescription=Check OhWhale short-lived certificate every hour\n\n[Timer]\nOnCalendar=hourly\nRandomizedDelaySec=5m\nPersistent=true\nUnit=ohwhale-ip-renew.service\n\n[Install]\nWantedBy=timers.target\n'
 };
}
function docker(dir,args,{capture=false}={}){const result=cp.spawnSync('docker',args,{cwd:dir,encoding:'utf8',stdio:capture?'pipe':'inherit',timeout:8*60*1000});if(result.error||result.status!==0)throw Error('Docker deployment step failed; inspect its local output (no TLS bypass will be attempted)');return result.stdout||'';}
function renewalStatus(run=args=>cp.spawnSync('systemctl',args,{encoding:'utf8',timeout:15000})){
 function show(unit,properties){const result=run(['show',unit,...properties.map(name=>'--property='+name)]);if(result.error||result.status!==0)throw Error('Cannot verify renewal systemd properties');const values={};for(const line of String(result.stdout||'').trim().split('\n')){const at=line.indexOf('=');if(at<1)continue;const name=line.slice(0,at);if(Object.hasOwn(values,name))throw Error('Duplicate renewal systemd property');values[name]=line.slice(at+1).trim();}for(const name of properties)if(!Object.hasOwn(values,name))throw Error('Missing renewal systemd property: '+name);return values;}
 const timer=show('ohwhale-ip-renew.timer',['UnitFileState','ActiveState']),service=show('ohwhale-ip-renew.service',['Result','ExecMainStatus','ActiveState','Type']);
 if(timer.UnitFileState!=='enabled'||timer.ActiveState!=='active')throw Error('Renewal timer must be persistently enabled and active');
 // A completed oneshot normally becomes inactive. Its last invocation result
 // is authoritative; systemctl status returning 3 for inactive is not failure.
 if(service.Type!=='oneshot'||!['inactive','active'].includes(service.ActiveState)||service.Result!=='success'||service.ExecMainStatus!=='0')throw Error('Last renewal oneshot did not finish successfully');
 return {renewalVerified:true,timerEnabled:true,timerActive:true,serviceResult:'success',execMainStatus:0,serviceActiveState:service.ActiveState};
}
async function runAction(action,{dir=process.cwd(),email=process.env.OH_ACME_EMAIL,agree=false,run=docker,inspect=certificate,health=trustedHealth,platform=process.platform}={}){
 dir=path.resolve(dir);const config=configAt(dir);
 if(process.platform==='linux')privateConfig(dir);
 if(action==='renewal-status'){if(platform!=='linux')throw Error('Run renewal verification on the Linux host');return renewalStatus();}
 if(action==='units'){const files=units(dir);for(const name of Object.keys(files))if(fs.existsSync(path.join(dir,name)))throw Error('Existing systemd template preserved');for(const [name,text]of Object.entries(files))fs.writeFileSync(path.join(dir,name),text,{flag:'wx',mode:0o600});return {prepared:true,installed:false};}
 if(action==='status'){const cert=inspect(dir,config.publicIP);await health(config.publicIP,cert.fingerprint);return {trustedHTTPS:true,expiresAt:cert.expiresAt,remainingHours:cert.remainingHours,attention:cert.remainingHours<48};}
 if(platform!=='linux')throw Error('Run deployment actions on the user-owned Linux server; local preparation does not deploy');
 fs.mkdirSync(path.join(dir,'runtime'),{recursive:true,mode:0o700});
 if(action==='bootstrap'&&process.platform==='linux')prepareFriendsData(dir);
 for(const sub of ['challenges','acme','acme-staging','work/production','work/staging','logs/production','logs/staging'])fs.mkdirSync(path.join(dir,'runtime',sub),{recursive:true,mode:0o700});
 const plan=commands(action,config,{email,agree});
 for(const args of plan){if(args.at(-1)==='--version')certbotVersion(run(dir,args,{capture:true}));else run(dir,args);}
 if(['issue','renew'].includes(action)){
  const cert=inspect(dir,config.publicIP);
  // Keep the bind-mounted file's inode: replacing it by rename leaves Docker
  // reading the old bootstrap file. The HTTPS template never loads staging.
  fs.writeFileSync(path.join(dir,'Caddyfile'),fs.readFileSync(path.join(dir,'Caddyfile.ip.https')),{mode:0o600});
  run(dir,['compose','-f','compose.ip.yaml','exec','-T','caddy','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile','--force']);
  await health(config.publicIP,cert.fingerprint);
  return {trustedHTTPS:true,expiresAt:cert.expiresAt,remainingHours:cert.remainingHours,attention:cert.remainingHours<48,timerStillRequired:true};
 }
 return {completed:action,trustedHTTPS:false};
}
if(require.main===module)runAction(process.argv[2],{agree:process.argv.includes('--agree-tos')}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={commands,certbotVersion,certificate,trustedHealth,units,renewalStatus,runAction};
