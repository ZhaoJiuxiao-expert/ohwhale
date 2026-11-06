'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeFriendCode,friendQRPayload,parseFriendQR}=require('../src/ui/friend-code.cjs');
test('friend code accepts typed case/spaces and canonicalizes without fuzzy identity substitution',()=>{
 assert.equal(normalizeFriendCode(' jw abcd efgh 2345 '),'JW-ABCD-EFGH-2345');
 assert.equal(normalizeFriendCode('jwabcdefgh2345'),'JW-ABCD-EFGH-2345');
 for(const bad of ['JW-ABCI-EFGH-2345','JW-ABCO-EFGH-2345','JW-ABC0-EFGH-2345','JW-ABC1-EFGH-2345','JW-ABCD-EFGH-23456','ABCD-EFGH-2345',null,'JW-ABCD\nEFGH-2345'])assert.throws(()=>normalizeFriendCode(bad));
});
test('friend QR contains only fixed protocol and public friend code; exact round trip',()=>{
 const code='JW-ABCD-EFGH-2345',payload=friendQRPayload(code);
 assert.equal(payload,'ohwhale:friend:v1:JW-ABCD-EFGH-2345');
 assert.equal(parseFriendQR(payload),code);assert.equal(normalizeFriendCode(payload),code);
 for(const bad of ['https://example.org/?code='+code,'javascript:alert(1)',code,'OH1.secret','ohwhale:friend:v2:'+code,payload+'?token=secret',payload+'\n','ohwhale:friend:v1:jw-abcd-efgh-2345'])assert.throws(()=>parseFriendQR(bad));
});
test('paste input rejects URL-like data, control bytes and payload overflow',()=>{
 for(const bad of ['https://47.86.23.218/'+friendQRPayload('JW-ABCD-EFGH-2345'),'ohwhale:friend:v1:JW-ABCD-EFGH-2345#secret','JW-ABCD-EFGH-2345\0','x'.repeat(161),{code:'JW-ABCD-EFGH-2345'}])assert.throws(()=>normalizeFriendCode(bad));
});
test('real QR encoder pixels decode back to the public friend identity',async()=>{
 const QRCode=require('qrcode'),jsQR=require('jsqr');
 const {PNG}=require('node:module').createRequire(require.resolve('qrcode'))('pngjs');
 const code='JW-ABCD-EFGH-2345',payload=friendQRPayload(code);
 const png=PNG.sync.read(await QRCode.toBuffer(payload,{width:600,margin:4,errorCorrectionLevel:'M'}));
 const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
 assert(decoded);assert.equal(decoded.data,payload);assert.equal(parseFriendQR(decoded.data),code);
});
