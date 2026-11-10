'use strict';
// Isolated packaged-artifact smoke. No account registration, provider keys, or model calls.
// EXE:  OHWHALE_QA_EXE=<absolute OhWhale.exe> node scripts/package-layout-qa.cjs
// ASAR: OHWHALE_QA_ASAR=<absolute app.asar> [ELECTRON_EXEC_PATH=<electron.exe>] node ...
// Optional: OHWHALE_QA_PROFILE=<new empty dir>, OHWHALE_QA_OUT=<new empty dir>.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{_electron}=require('playwright');
const asar=createRequire(require.resolve('@electron/packager'))('@electron/asar');
const root=path.resolve(__dirname,'..'),expectedVersion=process.env.OHWHALE_QA_VERSION||'1.7.0';
const exe=process.env.OHWHALE_QA_EXE||process.env.LINGYU_EXE||'';
const archive=process.env.OHWHALE_QA_ASAR?path.resolve(process.env.OHWHALE_QA_ASAR):exe?path.join(path.dirname(path.resolve(exe)),'resources','app.asar'):'';
const out=path.resolve(process.env.OHWHALE_QA_OUT||path.join(root,'artifacts','package-layout-qa-'+Date.now()));
const profile=path.resolve(process.env.OHWHALE_QA_PROFILE||path.join(out,'isolated-profile'));
const checks=[],errors=[],proxyBlocked=[];let app,page,proxy,archiveHash='',artifactVersion='',mainIdentity=null,passed=false,failure='',outputReady=false;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const check=(name,value=true)=>{assert(value,name);checks.push(name)};
function requireFreshDirectory(dir,label){if(fs.existsSync(dir)&&(!fs.statSync(dir).isDirectory()||fs.readdirSync(dir).length))throw Error(label+' must be a new or empty directory; existing data is never reused: '+dir);fs.mkdirSync(dir,{recursive:true});}
function launchEnvironment(){
 // Inherit only Windows/runtime essentials. Provider keys and signing credentials never reach the child.
 const allowed=['APPDATA','LOCALAPPDATA','PROGRAMDATA','PATH','SystemRoot','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','COMSPEC','PATHEXT','WINDIR','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PROCESSOR_IDENTIFIER','OS','SYSTEMDRIVE','PUBLIC','ALLUSERSPROFILE'];
 const env={};for(const key of allowed)if(process.env[key]!==undefined)env[key]=process.env[key];env.LINGYU_DATA_DIR=profile;return env;
}
async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});}
async function waitReady(){await page.getByTestId('lingyu-app').waitFor();await page.locator('.loading-overlay').waitFor({state:'hidden'});}
async function inspectRoom(){
 const input=page.getByTestId('room-message-input'),dialog=page.getByTestId('room-scene-dialog'),toggle=page.getByTestId('room-target-toggle'),picker=page.getByTestId('room-target-popover');
 await input.waitFor();check('3D is created only after explicit request',await page.getByTestId('room-scene-canvas').count()===0);
 const overview=await page.evaluate(()=>window.ly.roomsOverview()),record=await page.evaluate(id=>window.ly.roomsGet({roomId:id}),overview.rooms[0].id);
 check('dorm has three default companions',record.room.templateId==='dorm'&&JSON.stringify(record.room.agentIds)===JSON.stringify(['deepseek','qwen','kimi']));
 check('zero-friend dorm is locally available',!(await page.evaluate(()=>window.ly.friendsStatus())).enabled);
 check('dorm starts from local preset without model turn',record.turns.length===0&&record.messages.every(m=>m.source==='preset'));
 check('scene annotations default to private',record.scene.objects.every(o=>o.aiVisible===false));
 await input.fill('打包验收：关闭小屋后保留的草稿');
 for(const width of [1280,390,360]){
  await page.setViewportSize({width,height:width===1280?900:844});
  await page.waitForFunction(()=>document.querySelector('[data-testid="lingyu-app"]').dataset.chatFocus==='true');
  check('selected room hides sidebar '+width,await page.locator('.room-sidebar').isHidden());
  check('selected room keeps return action '+width,await page.getByTestId('room-back').isVisible());
  const before=await page.locator('.room-conversation').boundingBox();
  check('room occupies available content width '+width,before.width>=width-28);
  check('room has no horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await toggle.click();await picker.waitFor();await page.getByTestId('room-target-qwen').click();await picker.waitFor({state:'hidden'});
  check('target picker retains chosen name '+width,(await toggle.textContent()).includes(overview.agents.find(a=>a.id==='qwen').name));
  await toggle.click();await input.click();await picker.waitFor({state:'hidden'});
  check('outside picker close preserves input focus '+width,await input.evaluate(el=>document.activeElement===el));
  await shot('02-room-chat-'+width);
  await page.getByTestId('room-scene-open').click();await dialog.waitFor();await page.getByTestId('room-scene-canvas').locator('canvas').waitFor();
  check('native 3D modal is active '+width,await dialog.evaluate(el=>el.open&&el.matches(':modal')));
  const after=await page.locator('.room-conversation').boundingBox();
  check('3D overlay keeps chat dimensions '+width,Math.abs(before.width-after.width)<1&&Math.abs(before.height-after.height)<1);
  const rect=await dialog.boundingBox();check('3D overlay is large and inside viewport '+width,rect.width>=Math.min(900,width-24)&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+1);
  await page.getByTestId('room-object-desk').click();await dialog.getByLabel('描述',{exact:true}).fill('QA未保存的小屋故事');
  check('unsaved annotation stays private '+width,!await dialog.getByLabel('允许AI读取这段标注',{exact:true}).isChecked());
  await shot('03-room-scene-'+width);
  await page.getByTestId('room-scene-close').click();await dialog.waitFor({state:'hidden'});
  check('closing 3D keeps room draft '+width,await input.inputValue()==='打包验收：关闭小屋后保留的草稿');
  await page.getByTestId('room-scene-open').click();await dialog.waitFor();
  check('reopening 3D keeps unsaved scene edit '+width,await dialog.getByLabel('描述',{exact:true}).inputValue()==='QA未保存的小屋故事');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});check('Escape dismisses 3D '+width);
 }
 await page.setViewportSize({width:1280,height:900});await page.getByTestId('room-scene-open').click();await dialog.waitFor();await page.mouse.click(3,3);await dialog.waitFor({state:'hidden'});check('desktop backdrop dismisses 3D');
 await page.getByTestId('room-back').click();await page.getByTestId('group-hub').waitFor();check('room returns to groups hub');
 await page.getByTestId('hub-ai-dorm').click();await input.waitFor();check('same dorm reopens from hub without another room', (await page.evaluate(()=>window.ly.roomsOverview())).rooms.length===1);
 check('room draft survives return and reentry',await input.inputValue()==='打包验收：关闭小屋后保留的草稿');
 await page.getByTestId('room-back').click();await page.getByTestId('group-hub').waitFor();
 await page.getByTestId('hub-games').click();await page.locator('.room-games-heading').waitFor();check('games wait for explicit expansion',await page.locator('.room-games-heading').getAttribute('aria-expanded')==='false');
 await page.locator('.room-games-heading').click();check('games expand on request',await page.locator('.room-game-content').isVisible());await page.getByTestId('room-back').click();await page.getByTestId('group-hub').waitFor();
 await page.getByTestId('hub-games').click();await page.locator('.room-games-heading').waitFor();check('reentered games return collapsed',await page.locator('.room-games-heading').getAttribute('aria-expanded')==='false');

 await page.getByTestId('room-back').click();await page.getByTestId('group-hub').waitFor();await page.getByTestId('hub-ai-travel').click();await input.waitFor();
 const travelOverview=await page.evaluate(()=>window.ly.roomsOverview()),travel=travelOverview.rooms.find(r=>r.templateId==='travel');check('different preset opens travel room',!!travel&&await page.getByRole('heading',{name:travel.name,exact:true}).isVisible());await input.fill('旅行房间单独的草稿');
 await page.getByTestId('room-back').click();await page.getByTestId('group-hub').waitFor();await page.getByTestId('hub-all-rooms').click();await page.getByTestId('room-select-'+record.room.id).waitFor();
 check('all rooms opens saved room list',await page.locator('.room-sidebar').isVisible());await page.getByTestId('room-select-'+record.room.id).click();await input.waitFor();check('saved dorm opens from room list with its draft',await input.inputValue()==='打包验收：关闭小屋后保留的草稿');
 await page.getByTestId('room-back').click();await page.getByTestId('group-hub').waitFor();await page.getByTestId('hub-ai-travel').click();await input.waitFor();check('travel reentry keeps separate room context and draft',await input.inputValue()==='旅行房间单独的草稿');
 const finalOverview=await page.evaluate(()=>window.ly.roomsOverview());for(const r of finalOverview.rooms){const detail=await page.evaluate(id=>window.ly.roomsGet({roomId:id}),r.id);check('no AI turns created in '+r.templateId,detail.turns.length===0&&detail.messages.every(m=>m.source==='preset'));}
 check('friends remain disabled after all local flows',!(await page.evaluate(()=>window.ly.friendsStatus())).enabled);
}
async function main(){
 if(!archive)throw Error('Set OHWHALE_QA_EXE to the packaged OhWhale.exe or OHWHALE_QA_ASAR to app.asar.');
 if(!fs.existsSync(archive))throw Error('Packaged archive was not found: '+archive);
 if(exe&&!fs.existsSync(path.resolve(exe)))throw Error('Packaged executable was not found: '+exe);
 requireFreshDirectory(out,'OHWHALE_QA_OUT');outputReady=true;requireFreshDirectory(profile,'OHWHALE_QA_PROFILE');
 artifactVersion=JSON.parse(asar.extractFile(archive,'package.json')).version;check('packaged manifest version matches '+expectedVersion,artifactVersion===expectedVersion);archiveHash=hash(archive);
 // A deny proxy is supplied at process launch, before any page can run. Session interception
 // below adds per-request evidence. Both paths refuse every HTTP(S) destination.
 proxy=http.createServer((req,res)=>{proxyBlocked.push({method:req.method,url:req.url});res.writeHead(403);res.end('Offline packaged layout QA');});
 proxy.on('connect',(req,socket)=>{proxyBlocked.push({method:'CONNECT',url:req.url});socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const proxyAddress='127.0.0.1:'+proxy.address().port;
 const args=[...(exe?[]:[archive]),'--mute-audio','--proxy-server=http://'+proxyAddress,'--proxy-bypass-list=<-loopback>','--disable-background-networking'];
 app=await _electron.launch({executablePath:exe?path.resolve(exe):(process.env.ELECTRON_EXEC_PATH||require('electron')),args,env:launchEnvironment()});
 app.process().stderr?.on('data',chunk=>fs.appendFileSync(path.join(out,'stderr.txt'),chunk));
 await app.evaluate(async({app,session,shell},proxyAddress)=>{
  global.__packageLayoutQa={blocked:[],mainErrors:[]};
  process.on('uncaughtException',e=>global.__packageLayoutQa.mainErrors.push(String(e?.stack||e)));
  process.on('unhandledRejection',e=>global.__packageLayoutQa.mainErrors.push(String(e?.stack||e)));
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(details,callback)=>{global.__packageLayoutQa.blocked.push({method:details.method,url:details.url});callback({cancel:true})});
  await session.defaultSession.setProxy({proxyRules:'http='+proxyAddress+';https='+proxyAddress,proxyBypassRules:'<-loopback>'});
  await session.defaultSession.closeAllConnections();
  shell.openExternal=async()=>{throw Error('External links are disabled during offline package layout QA')};
 },proxyAddress);
 page=await app.firstWindow();page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\//,route=>route.abort());await waitReady();
 mainIdentity=await app.evaluate(({app})=>({appPath:app.getAppPath(),version:app.getVersion(),isPackaged:app.isPackaged,main:process.mainModule.filename}));
 check('runtime loads specified app.asar',path.resolve(mainIdentity.appPath)===path.resolve(archive)&&path.resolve(mainIdentity.main)===path.resolve(archive,'src/main.cjs'));
 if(exe)check('actual packaged EXE is running',mainIdentity.isPackaged===true);
 const initial=await page.evaluate(()=>window.ly.bootstrap());check('runtime and preload report '+expectedVersion,mainIdentity.version===expectedVersion&&initial.runtime.version===expectedVersion);
 check('profile is isolated',path.resolve(initial.runtime.dataDirectory)===profile);check('startup defaults to chat',await page.getByTestId('lingyu-app').getAttribute('data-view')==='chat');
 check('new profile starts without friends',!(await page.evaluate(()=>window.ly.friendsStatus())).enabled);check('startup creates no room',(await page.evaluate(()=>window.ly.roomsOverview())).rooms.length===0);
 for(const width of [1280,390,360]){await page.setViewportSize({width,height:width===1280?900:844});const nav=page.locator(width===1280?'.desktop-primary-nav>button':'.app-rail>button');check('four main navigation labels '+width,JSON.stringify(await nav.allTextContents())===JSON.stringify(['聊天','群聊','动态','我']));check('startup fits viewport '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('01-startup-chat-'+width);}
 await page.setViewportSize({width:1280,height:900});await page.getByTestId('desktop-nav-groups').click();await page.getByTestId('group-hub').waitFor();check('groups navigation opens group hub');
 for(const id of ['hub-human-groups','hub-ai-dorm','hub-games','hub-add-friend'])check('hub action '+id+' is available',await page.getByTestId(id).isVisible());await shot('01b-group-hub');
 await page.getByTestId('hub-ai-dorm').click();await inspectRoom();
 check('no renderer errors',errors.length===0);const main=await app.evaluate(()=>global.__packageLayoutQa);check('no main process errors',main.mainErrors.length===0);check('no model endpoint requested',![...main.blocked,...proxyBlocked].some(r=>/chat\/completions|generate|\/responses(?:\?|$)/.test(r.url)));check('packaged archive bytes remain unchanged',archiveHash===hash(archive));passed=true;
}
async function finish(){
 let captured={blocked:[],mainErrors:[]};if(app)try{captured=await app.evaluate(()=>global.__packageLayoutQa||{blocked:[],mainErrors:[]})}catch{}
 if(outputReady)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed,expectedVersion,artifactVersion,executable:exe?path.resolve(exe):null,asarPath:archive,asarSHA256:archiveHash,profile,mainIdentity,checks,errors,mainErrors:captured.mainErrors,blockedNetwork:captured.blocked,launchProxyBlocked:proxyBlocked,error:failure||undefined,scope:'Actual specified Windows packaged EXE or ASAR, fresh isolated profile, real renderer/preload/local core. All external networking denied; no account registration or model calls. Narrow 390/360px checks are desktop responsive rendering, not Android hardware installation.'},null,2));
 await app?.close().catch(()=>{});await new Promise(resolve=>{if(proxy)proxy.close(resolve);else resolve()});
}
main().catch(async e=>{failure=e.stack||String(e);if(outputReady)await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});if(outputReady)fs.writeFileSync(path.join(out,'failure.txt'),failure);console.error(e.message);process.exitCode=1}).finally(async()=>{await finish();console.log(JSON.stringify({passed,out,checks:checks.length}));});
