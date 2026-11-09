'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {externalLink,TERMS_URL}=require('../src/core/external-links.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('only the published agreement can leave the trusted application',()=>{
 assert.equal(externalLink({url:TERMS_URL}),TERMS_URL);
 for(const url of ['javascript:alert(1)','file:///C:/secret','https://47.86.23.218/terms?secret=x','https://47.86.23.218.evil.test/terms','intent://settings',null])assert.throws(()=>externalLink({url}));
});

test('Android native agreement intent remains exact-URL, trusted-page only, and outside the application WebView',()=>{
 const native=fs.readFileSync(path.join(__dirname,'../android/src/cn/ohwhale/chat/MainActivity.java'),'utf8'),start=native.indexOf('case "openExternal":'),end=native.indexOf('case "proactiveEnable":',start),branch=native.slice(start,end);assert.ok(start>0&&end>start);
 assert.ok(branch.includes('if(!"'+TERMS_URL+'".equals(url))throw new Exception'));
 assert.match(branch,/required\(a,"url",128\)/);assert.match(branch,/if\(!trustedPage\)throw new Exception/);assert.match(branch,/Intent\.ACTION_VIEW,Uri\.parse\(url\)/);assert.match(branch,/Intent\.CATEGORY_BROWSABLE/);assert.doesNotMatch(branch,/web\.loadUrl|setJavaScriptEnabled|FLAG_GRANT/);
 const entry=native.slice(native.indexOf('@JavascriptInterface public void postMessage'),native.indexOf('private void dispatch'));assert.match(entry,/if\(!trustedPage\|\|raw==null/);
});

test('desktop preload and actual IPC handler reject bad senders and URLs before opening the agreement',async()=>{
 const main=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),preload=fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),bind=main.split('\n').find(line=>line.startsWith('function bind(name,fn)')),registration=main.split('\n').find(line=>line.trim().startsWith("bind('openExternal',"));assert.ok(bind&&registration);
 const handlers=new Map(),opened=[],webContents={},uiURL='file:///synthetic/trusted/index.html',event={sender:webContents,senderFrame:{url:uiURL}};
 vm.runInNewContext(bind+'\n'+registration,{ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},win:{webContents},uiURL,externalLink,shell:{openExternal:async url=>opened.push(url)}});
 let api;vm.runInNewContext(preload,{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'ly');api=value;}},ipcRenderer:{on(){},removeListener(){},invoke:(name,input)=>handlers.get(name)(event,input)}};}});
 assert.equal(await api.openExternal({url:TERMS_URL}),true);assert.deepEqual(opened,[TERMS_URL]);
 for(const url of ['javascript:alert(1)','file:///C:/secret','https://47.86.23.218/terms?key=private','https://47.86.23.218.evil.invalid/terms','intent://settings'])await assert.rejects(api.openExternal({url}),/链接/);
 const handler=handlers.get('ly:openExternal');await assert.rejects(handler({sender:{},senderFrame:{url:uiURL}},{url:TERMS_URL}),/未授权/);await assert.rejects(handler({sender:webContents,senderFrame:{url:'https://evil.invalid'}},{url:TERMS_URL}),/未授权/);assert.deepEqual(opened,[TERMS_URL]);
});
