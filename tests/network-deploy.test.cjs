'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),{EventEmitter}=require('node:events');
const {commands,certbotVersion,runAction,trustedHealth,units,renewalStatus}=require('../server/deploy/ip-https.cjs');
const {privateConfig}=require('../server/deploy/preflight.cjs');
const root=path.join(__dirname,'..'),temp=prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix));
function generate(extra={}){const dir=temp('ohwhale-ip-'),result=spawnSync(process.execPath,[path.join(root,'server/deploy/configure.cjs')],{cwd:dir,env:{...process.env,OH_HTTPS_MODE:'ip',OH_PUBLIC_IP:'203.0.113.10',OH_PRIVATE_IP:'10.0.0.2',OH_SIGNAL_DOMAIN:'',OH_TURN_DOMAIN:'',...extra},encoding:'utf8'});return {dir,result};}
test('IP generator separates ACME challenge bootstrap and explicit production TLS without leaking credentials',()=>{
 const {dir,result}=generate();assert.equal(result.status,0,result.stderr);const bootstrap=fs.readFileSync(path.join(dir,'Caddyfile'),'utf8'),https=fs.readFileSync(path.join(dir,'Caddyfile.ip.https'),'utf8'),env=fs.readFileSync(path.join(dir,'secrets.env'),'utf8');
 assert.ok(bootstrap.includes('/.well-known/acme-challenge/*'));assert.ok(bootstrap.includes('503'));assert.ok(!bootstrap.includes('reverse_proxy'));assert.ok(https.includes('https://203.0.113.10'));assert.ok(https.includes('/certs/live/ohwhale-ip/privkey.pem'));assert.ok(!https.includes('staging'));assert.ok(!https.includes('tls internal'));assert.ok(env.includes('SIGNAL_PUBLIC_URL=https://203.0.113.10'));
 assert.ok(bootstrap.startsWith('{\n  default_sni 203.0.113.10\n}\n'));assert.ok(https.startsWith('{\n  default_sni 203.0.113.10\n}\n'));assert.equal((https.match(/default_sni/g)||[]).length,1);
 for(const value of [/SIGNAL_OWNER_TOKEN=(.+)/.exec(env)[1],/TURN_SHARED_SECRET=(.+)/.exec(env)[1]])assert.ok(!result.stdout.includes(value));
 for(const bad of ['evil.invalid\nrespond x','bad..invalid','-bad.invalid','a'.repeat(64)+'.invalid'])assert.notEqual(generate({OH_TURN_DOMAIN:bad}).result.status,0);
 assert.notEqual(generate({OH_HTTPS_MODE:'fake'}).result.status,0);
});
test('Certbot commands require consent and 5.4+, separate staging state and never force unnecessary renewal',()=>{
 const cfg={publicIP:'203.0.113.10'};assert.throws(()=>commands('issue',cfg,{email:'mine@example.invalid'}));assert.throws(()=>commands('stage',cfg,{email:'bad\n@example.invalid',agree:true}));
 assert.throws(()=>certbotVersion('certbot 5.3.2'));assert.throws(()=>certbotVersion('unknown'));assert.equal(certbotVersion('certbot 5.9.0'),'certbot 5.9.0');
 const stage=commands('stage',cfg,{email:'mine@example.invalid',agree:true})[1],issue=commands('issue',cfg,{email:'mine@example.invalid',agree:true})[1],renew=commands('renew',cfg)[1],dry=commands('renew-test',cfg)[1];
 assert.ok(stage.includes('--staging'));assert.ok(stage.includes('/var/lib/ohwhale/acme-staging'));assert.ok(!issue.includes('--staging'));assert.ok(issue.includes('/var/lib/ohwhale/acme'));assert.ok(issue.includes('--required-profile'));assert.ok(issue.includes('--ip-address'));assert.ok(renew.includes('--no-directory-hooks'));assert.ok(!renew.includes('--force-renewal'));assert.ok(!renew.includes('--dry-run'));assert.ok(dry.includes('--dry-run'));assert.ok(!dry.includes('--run-deploy-hooks'));
 for(const args of [stage,issue,renew,dry])assert.ok(!args.includes('--no-verify-ssl'));
});
test('orchestration refuses old Certbot and failed production validation before activating HTTPS; renewal reloads and verifies',async()=>{
 const {dir}=generate(),before=fs.readFileSync(path.join(dir,'Caddyfile'),'utf8');let calls=[];
 const base={dir,platform:'linux',email:'mine@example.invalid',agree:true,run:(_dir,args)=>{calls.push(args);return args.at(-1)==='--version'?'certbot 5.9.0':'';},inspect:()=>({fingerprint:'expected',remainingHours:150,expiresAt:'2099-01-01'}),health:async(ip,fingerprint)=>{assert.equal(ip,'203.0.113.10');assert.equal(fingerprint,'expected');}};
 await assert.rejects(runAction('issue',{...base,run:()=> 'certbot 5.3.0'}),/5.4/);assert.equal(fs.readFileSync(path.join(dir,'Caddyfile'),'utf8'),before);
 await assert.rejects(runAction('issue',{...base,inspect:()=>{throw Error('SAN mismatch');}}),/SAN mismatch/);assert.ok(!calls.some(a=>a.includes('reload')));assert.equal(fs.readFileSync(path.join(dir,'Caddyfile'),'utf8'),before);
 calls=[];await runAction('stage',base);await runAction('renew-test',base);assert.ok(!calls.some(a=>a.includes('reload')));assert.equal(fs.readFileSync(path.join(dir,'Caddyfile'),'utf8'),before);
 calls=[];const result=await runAction('renew',base);assert.equal(result.trustedHTTPS,true);assert.ok(calls.some(a=>a.includes('reload')&&a.includes('--force')));assert.equal(fs.readFileSync(path.join(dir,'Caddyfile'),'utf8'),fs.readFileSync(path.join(dir,'Caddyfile.ip.https'),'utf8'));
 await assert.rejects(runAction('renew',{...base,health:async()=>{throw Error('untrusted TLS');}}),/untrusted TLS/);
 await assert.rejects(runAction('bootstrap',{...base,platform:'win32'}),/Linux/);
});
test('HTTPS verification requires trusted TLS, exact certificate fingerprint, nonredirect health and bounded response',async()=>{
 function transport({status=200,fingerprint='expected',body='{"ok":true}'}={}){return {get(options,callback){assert.equal(options.rejectUnauthorized,true);assert.equal(options.hostname,'203.0.113.10');assert.equal(options.path,'/health');assert.equal(Object.hasOwn(options,'headers'),false);const req=new EventEmitter();req.destroy=error=>req.emit('error',error);queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;res.socket={getPeerCertificate:()=>({fingerprint256:fingerprint})};res.setEncoding=()=>{};callback(res);res.emit('data',body);res.emit('end');});return req;}};}
 await trustedHealth('203.0.113.10','expected',transport());
 for(const options of [{status:302},{fingerprint:'other'},{body:'{"ok":false}'},{body:'x'.repeat(9000)}])await assert.rejects(trustedHealth('203.0.113.10','expected',transport(options)));
});
test('renewal timer is explicit, hourly and never installed by preparation; white-list bundle excludes runtime state',async()=>{
 const {dir}=generate();await assert.rejects(runAction('units',{dir}),/exact reviewed Linux directory/);assert.equal(fs.existsSync(path.join(dir,'ohwhale-ip-renew.service')),false);const generated=units('/opt/ohwhale-network'),service=generated['ohwhale-ip-renew.service'],timer=generated['ohwhale-ip-renew.timer'];assert.ok(service.includes('UMask=0077'));assert.ok(service.includes(' renew'));assert.ok(timer.includes('OnCalendar=hourly'));assert.ok(timer.includes('Persistent=true'));
 const bundle=path.join(temp('ohwhale-ip-bundle-'),'deployment');const prepared=spawnSync(process.execPath,[path.join(root,'scripts/prepare-network-deploy.cjs'),bundle],{encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);for(const name of ['compose.ip.yaml','ip-https.cjs','IP-HTTPS.md'])assert.ok(fs.existsSync(path.join(bundle,name)));for(const name of ['secrets.env','runtime','turnserver.conf','network-deployment.json'])assert.ok(!fs.existsSync(path.join(bundle,name)));assert.ok(fs.readFileSync(path.join(bundle,'.dockerignore'),'utf8').includes('runtime/'));const compose=fs.readFileSync(path.join(bundle,'compose.ip.yaml'),'utf8');assert.ok(compose.includes('certbot/certbot:v5.9.0'));assert.ok(!compose.includes('/var/run/docker.sock'));
});
test('systemd249 WorkingDirectory is an absolute literal without argv quotes, and unsupported paths cannot inject units',()=>{
 const files=units('/opt/ohwhale-network'),service=files['ohwhale-ip-renew.service'];
 const working=service.split('\n').filter(line=>line.startsWith('WorkingDirectory='));assert.deepEqual(working,['WorkingDirectory=/opt/ohwhale-network']);assert.equal(working[0].split('=')[1][0],'/');assert.equal(working[0].includes('"'),false);assert.equal(working[0].includes('%'),false);
 assert.deepEqual(service.split('\n').filter(line=>line.startsWith('ExecStart=')),['ExecStart=/usr/local/bin/node /opt/ohwhale-network/ip-https.cjs renew']);
 for(const value of ['/opt/another','/opt/ohwhale network','/opt/ohwhale-network\nExecStart=/bin/false','/opt/"ohwhale-network"','/opt/%h','/opt/../ohwhale-network','C:\\opt\\ohwhale-network','/opt/ohwhale-network/'])assert.throws(()=>units(value),/exact reviewed Linux directory/);
});
test('production preflight rejects non-root, loose secret permissions, symlinks and non-private runtime without granting capabilities',()=>{
 const dir=path.resolve('/deployment');let wrong='';
 const stat=file=>{const name=path.basename(file),folder=file===dir||name==='runtime',entry={uid:0,gid:0,mode:folder?(name==='runtime'?0o700:0o755):0o600,isDirectory:()=>folder,isFile:()=>!folder,isSymbolicLink:()=>false};if(name==='turnserver.conf'&&wrong==='owner')entry.uid=1000;if(name==='turnserver.conf'&&wrong==='mode')entry.mode=0o644;if(name==='turnserver.conf'&&wrong==='link')entry.isSymbolicLink=()=>true;if(name==='runtime'&&wrong==='runtime')entry.mode=0o755;return entry;};
 assert.deepEqual(privateConfig(dir,{uid:0,stat}),{privateConfigVerified:true});assert.throws(()=>privateConfig(dir,{uid:1000,stat}),/root/);
 for(wrong of ['owner','mode','link','runtime'])assert.throws(()=>privateConfig(dir,{uid:0,stat}));
});
test('TURN starts a capability-free public ELF copy, retaining private configuration and a zero-capability bounding set',()=>{
 for(const name of ['compose.yaml','compose.ip.yaml']){
  const yaml=fs.readFileSync(path.join(root,'server/deploy',name),'utf8'),turn=yaml.split('\n  turn:\n')[1].split('\nvolumes:')[0];
  assert.ok(turn.includes('user: "0:0"'));assert.ok(turn.includes('cap_drop: [ALL]'));assert.ok(turn.includes('no-new-privileges:true'));assert.ok(turn.includes('read_only: true'));assert.ok(turn.includes('/run/ohwhale-turn:rw,exec,nosuid,nodev,mode=0700,size=32m'));assert.ok(!turn.includes('cap_add:'));
  assert.ok(turn.includes('entrypoint:\n      - /bin/sh\n      - -ec\n      - |'));assert.ok(turn.includes('cp --no-preserve=xattr /usr/bin/turnserver /run/ohwhale-turn/turnserver'));assert.ok(turn.includes('exec /run/ohwhale-turn/turnserver -c /etc/coturn/turnserver.conf'));assert.ok(turn.includes('./turnserver.conf:/etc/coturn/turnserver.conf:ro'));assert.ok(!turn.includes('chmod 0644'));assert.ok(!turn.includes('eval '));
 }
});
test('normal inactive oneshot passes only with enabled active timer and successful zero-status service; real failures propagate',()=>{
 function runner({enabled='enabled',timer='active',result='success',exit='0',service='inactive',type='oneshot',status=0,missing=false}={}){return args=>{assert.equal(args[0],'show');assert.ok(args.every(arg=>!arg.includes('status ')));return {status,stdout:args[1].endsWith('.timer')?`UnitFileState=${enabled}\nActiveState=${timer}\n`:`Result=${result}\n${missing?'':`ExecMainStatus=${exit}\n`}ActiveState=${service}\nType=${type}\n`};};}
 assert.deepEqual(renewalStatus(runner()),{renewalVerified:true,timerEnabled:true,timerActive:true,serviceResult:'success',execMainStatus:0,serviceActiveState:'inactive'});
 for(const value of [{enabled:'disabled'},{enabled:'enabled-runtime'},{timer:'inactive'},{result:'exit-code',exit:'1',service:'failed'},{result:'timeout'},{exit:'1'},{service:'activating'},{service:'failed'},{type:'simple'},{status:1},{missing:true}])assert.throws(()=>renewalStatus(runner(value)));
 assert.throws(()=>renewalStatus(()=>({error:Error('systemctl missing'),status:null,stdout:''})),/Cannot verify/);
 const shell=fs.readFileSync(path.join(root,'server/deploy/deploy-ubuntu2204.sh'),'utf8');assert.ok(shell.includes('systemctl start ohwhale-ip-renew.service'));assert.ok(shell.includes('systemctl enable --now ohwhale-ip-renew.timer'));assert.ok(shell.includes('node ip-https.cjs renewal-status'));assert.ok(!shell.includes('systemctl --no-pager status ohwhale-ip-renew.timer ohwhale-ip-renew.service'));assert.ok(!shell.includes('renewal-status || true'));
});
test('image copies app sources world-readable for nonroot node while private mounts stay private',()=>{
 const dockerfile=fs.readFileSync(path.join(root,'server/Dockerfile'),'utf8');
 const copyLines=dockerfile.split(/\r?\n/).filter(line=>/^COPY\s/.test(line));
 assert.equal(copyLines.length,2);assert.ok(copyLines.every(line=>/^COPY --chmod=0644 /.test(line)));
 for(const file of ['server/signaling.cjs','server/friends.cjs','server/managed-ai.cjs','server/managed-models.json','src/p2p/network.js','src/p2p/peer.js'])assert.ok(copyLines.some(line=>line.split(/\s+/).includes(file)),file);
 const directoryFix='RUN chmod 0755 /app /app/server /app/src /app/src/p2p';assert.ok(dockerfile.includes(directoryFix));assert.ok(dockerfile.indexOf(directoryFix)>dockerfile.lastIndexOf('COPY '));assert.ok(dockerfile.indexOf(directoryFix)<dockerfile.indexOf('USER node'));assert.ok(dockerfile.includes('USER node'));assert.ok(copyLines.every(line=>!/(secrets\.env|runtime|managed-key)/.test(line)));
 const compose=fs.readFileSync(path.join(root,'server/deploy/compose.update-managed.yaml'),'utf8');assert.ok(compose.includes('./runtime/managed-key:/run/managed-ai/key:ro'));
 const keyRead=fs.readFileSync(path.join(root,'server/signaling.cjs'),'utf8');assert.ok(keyRead.includes('(stat.mode&0o777)!==0o600'));assert.ok(keyRead.includes('(data.mode&0o777)!==0o700'));
});
