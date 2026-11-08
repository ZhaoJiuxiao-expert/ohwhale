'use strict';
// Browser-rendered Android UI contract test. The native bridge and notification grant are fixtures.
// This does not assert Android OS scheduling, notifications, or physical-device behavior.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts','proactive-android-ui-qa-'+Date.now());
fs.mkdirSync(out,{recursive:true});
let browser;const errors=[],checks=[],networkRequests=[];
(async()=>{
 browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route(/^https?:\/\//,route=>{networkRequests.push(route.request().url());return route.abort();});
 const agents=require('../src/data/agents.json').slice(0,2).map(a=>({...a,greeting:{enabled:true,hour:10,mode:'natural'}}));
 await context.addInitScript(({agents})=>{
  const listeners=new Set(),now=new Date().toISOString();
  const state={agents,providers:[],conversations:agents.map((a,i)=>({id:'fixture-conversation-'+i,type:'ai',agentId:a.id,name:a.name,createdAt:now,updatedAt:now,archived:false,pinned:false,read:true})),messages:{},drafts:{},settings:{displayName:'界面验收',autoVoice:false,quietHours:{enabled:true,start:23,end:8},proactive:{background:false}},greetings:{}};
  for(const c of state.conversations)state.messages[c.id]=[{id:'greeting-'+c.id,role:'assistant',source:'ai',greeting:true,status:'sent',text:'受控界面验收：一条已经保存的问候。',attachments:[],createdAt:now,model:'fixture-model'}];
  const fixture={permission:false,background:false,configureCalls:[],settingsCalls:0,statusCalls:0,unexpected:[]};
  const getStatus=()=>({supported:true,backgroundEnabled:fixture.background,notificationsAllowed:fixture.permission,scheduled:fixture.background,busy:false,agents:agents.map(a=>({agentId:a.id,status:'not-due',attempts:0}))});
  const api={
   bootstrap:async()=>({state:JSON.parse(JSON.stringify(state)),plugins:{settings:{proactive:true,memory:true,voice:true,stickers:true},memories:[],diary:[],posts:[]},runtime:{version:'fixture',platform:'android',capabilities:{proactive:true,tts:false,microphone:false},proactive:getStatus(),customStickers:[]}}),
   proactiveStatus:async()=>{fixture.statusCalls++;return getStatus();},
   proactiveConfigure:async input=>{fixture.configureCalls.push({...input});if(input.background&&!fixture.permission)throw Error('先允许小鲸发送通知，后台问候才能开启哦。');fixture.background=input.background;state.settings.proactive.background=input.background;return getStatus();},
   proactiveOpenSettings:async()=>{fixture.settingsCalls++;return true;},
   proactiveOpenPending:async()=>getStatus(),
   onEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},setCloseHandler:()=>{},
   setConversation:async input=>{const c=state.conversations.find(c=>c.id===input.id);Object.assign(c,input);return {...c};},
   saveDraft:async input=>{state.drafts[input.conversationId]=input.text;return input;},
   friendsStatus:async()=>({enabled:false}),friendsState:async()=>({contacts:[],requests:{incoming:[],outgoing:[]},calls:[]}),
   shareStatus:async()=>({running:false}),stopSpeech:async()=>true,shareStop:async()=>({running:false})
  };
  window.ly=new Proxy(api,{get:(target,key)=>key in target?target[key]:async()=>{fixture.unexpected.push(String(key));throw Error('Unexpected fixture bridge method: '+String(key));}});
  fixture.emit=event=>{for(const listener of listeners)listener(event);};window.__proactiveFixture=fixture;
 },{agents});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(root,'src/ui/index.html')).href);
 await page.getByTestId('lingyu-app').waitFor();await page.locator('.loading-overlay').waitFor({state:'hidden'});
 const noOverflow=async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');const dialogs=await page.getByRole('dialog').count();if(dialogs)assert(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'dialog overflow');};
 await page.getByRole('button',{name:'我的',exact:true}).click();await page.getByTestId('me-settings').click();await page.getByRole('button',{name:'通用偏好',exact:true}).click();
 await page.getByTestId('proactive-panel').waitFor();const toggle=page.getByTestId('background-greeting-toggle'),consent=page.getByTestId('background-greeting-consent');await toggle.scrollIntoViewIfNeeded();assert(await toggle.isDisabled());assert.equal(await page.evaluate(()=>window.__proactiveFixture.configureCalls.length),0);
 await noOverflow();await page.screenshot({path:path.join(out,'01-390-before-consent.png')});checks.push('Android panel at 390px requires explicit checkbox; no configuration calls before consent');
 await consent.check();assert(await toggle.isEnabled());await toggle.click();await page.getByRole('alert').filter({hasText:'先允许小鲸发送通知'}).waitFor();await page.getByText('后台问候未开启',{exact:true}).waitFor();assert.equal(await page.getByText('后台问候已开启',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.__proactiveFixture.background),false);
 await page.getByLabel('关闭错误提示',{exact:true}).click();await page.getByRole('button',{name:'查看系统通知设置',exact:true}).click();assert.equal(await page.evaluate(()=>window.__proactiveFixture.settingsCalls),1);checks.push('denied native notification permission remains off; system-settings action reaches the bridge');
 await page.evaluate(()=>{window.__proactiveFixture.permission=true;});await page.getByTestId('refresh-proactive').click();await page.getByText('通知已允许',{exact:true}).waitFor();if(!await consent.isChecked())await consent.check();await toggle.click();await page.getByText('后台问候已开启',{exact:true}).waitFor();assert.equal(await toggle.innerText(),'暂停后台问候');assert.equal(await consent.count(),0);await page.setViewportSize({width:360,height:800});await toggle.scrollIntoViewIfNeeded();await noOverflow();await page.screenshot({path:path.join(out,'02-360-enabled.png')});
 await toggle.click();await page.getByText('后台问候未开启',{exact:true}).waitFor();assert(await consent.isVisible());assert(!await consent.isChecked());assert(await toggle.isDisabled());assert.equal(await page.evaluate(()=>window.__proactiveFixture.background),false);checks.push('explicit allowed grant enables at 360px; pause disables it and resets the opt-in checkbox');
 await page.getByLabel('关闭对话框',{exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(()=>window.__proactiveFixture.emit({type:'open-conversation',conversationId:'fixture-conversation-1'}));await page.locator('[data-testid="lingyu-app"][data-view="chat"][data-mobile-chat="true"]').waitFor();await page.locator('.cs-conversation-header .header-title').filter({hasText:agents[1].name}).waitFor();await page.waitForTimeout(350);await noOverflow();await page.screenshot({path:path.join(out,'03-360-notification-navigation.png')});checks.push('native notification event navigates from My screen to the target chat and mobile conversation view');
 const calls=await page.evaluate(()=>({configure:window.__proactiveFixture.configureCalls,settings:window.__proactiveFixture.settingsCalls,unexpected:window.__proactiveFixture.unexpected}));assert.deepEqual(calls.configure,[{background:true},{background:true},{background:false}]);assert.deepEqual(calls.unexpected,[]);assert.deepEqual(errors,[]);assert.deepEqual(networkRequests,[]);
 const result={passed:true,scope:'Playwright Edge rendering of production UI with synthetic Android bootstrap/native permission bridge; not actual Android hardware, notifications, JobScheduler, or paid API',checks,bridgeCalls:calls,rendererErrors:errors,externalNetworkRequests:networkRequests,artifacts:out};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();});
