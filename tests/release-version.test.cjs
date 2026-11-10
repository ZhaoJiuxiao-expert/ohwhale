'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
test('1.7.0 Windows, Android runtime and Android manifest share the release version and increasing code10700',()=>{
 const desktop=require('../package.json'),mobile=require('../src/mobile/version.json'),manifest=fs.readFileSync(path.join(root,'android/AndroidManifest.xml'),'utf8');
 assert.equal(desktop.version,'1.7.0');assert.equal(mobile.version,desktop.version);assert.equal(mobile.versionCode,10700);assert.ok(mobile.versionCode>10600);
 assert.equal(/android:versionName="([^"]+)"/.exec(manifest)[1],mobile.version);assert.equal(Number(/android:versionCode="(\d+)"/.exec(manifest)[1]),mobile.versionCode);
});
test('default pairing service is only a public HTTPS origin and carries no authorization material',()=>{
 const defaults=require('../src/data/network-defaults.json');assert.deepEqual(Object.keys(defaults),['signalingServerUrl']);const url=new URL(defaults.signalingServerUrl);
 assert.equal(url.origin,'https://47.86.23.218');assert.equal(url.protocol,'https:');assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.search,'');assert.equal(url.hash,'');assert.equal(url.pathname,'/');
});
