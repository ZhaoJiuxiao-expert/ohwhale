'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ManagedAI}=require('../server/managed-ai.cjs'),catalog=require('../server/managed-models.json');
const targetIds=['deepseek-ai/deepseek-v4.1-flash','qwen/qwen3.5-flash','moonshotai/kimi-k2.6'],principal={id:'synthetic-thinking-policy-device'},messages=[{role:'user',content:'Synthetic daily chat'}];
function fixture(finish='stop'){const calls=[],dir=fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-thinking-policy-')),ai=new ManagedAI({apiKey:'synthetic-policy-key',dir,fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'Synthetic reply'},finish_reason:finish}]}),{headers:{'content-type':'application/json'}});}});return {ai,calls};}
test('only the three exact daily-chat model IDs receive server-owned thinking disabled with unchanged token caps',async()=>{
 for(const model of targetIds){assert.ok(catalog.some(m=>m.id===model));const {ai,calls}=fixture();await ai.chat({principal,ip:'synthetic-ip',input:{model,messages,max_tokens:700,stream:true}});assert.equal(calls.length,1);assert.deepEqual(calls[0],{url:'https://api.atlascloud.ai/v1/chat/completions',body:{model,messages,stream:false,max_tokens:700,thinking:{type:'disabled'}}});assert.equal(ai.usage(principal).requestsUsed,1);}
 const {ai,calls}=fixture();await ai.chat({principal,ip:'synthetic-ip',input:{model:targetIds[0],messages}});assert.equal(calls[0].body.max_tokens,4096);
});
test('every other catalog model keeps its original request fields without a family-wide or version-suffix match',async()=>{
 const others=catalog.filter(m=>!targetIds.includes(m.id));assert.ok(others.some(m=>m.id==='deepseek-ai/deepseek-v4.1-flash-1017'));assert.ok(others.some(m=>m.id==='qwen/qwen3.8-27b'));assert.ok(others.some(m=>m.id==='moonshotai/kimi-k3'));assert.ok(others.some(m=>m.id==='bytedance/doubao-seed-character-260628'));
 for(const {id:model}of others){const {ai,calls}=fixture();await ai.chat({principal,ip:'synthetic-ip',input:{model,messages,max_tokens:256}});assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{model,messages,stream:false,max_tokens:256});}
});
test('public thinking, reasoning and tool fields are still rejected before model requests or quota reservations',async()=>{
 const {ai,calls}=fixture();for(const extra of [{thinking:{type:'enabled'}},{thinking:{type:'disabled'}},{enable_thinking:false},{reasoning_effort:'none'},{tools:[]},{tool_choice:'none'}])await assert.rejects(ai.chat({principal,ip:'synthetic-ip',input:{model:targetIds[0],messages,...extra}}),e=>e.code==='BAD_SCHEMA');assert.equal(calls.length,0);assert.equal(ai.usage(principal).requestsUsed,0);
});
test('an incomplete daily-chat response remains failed with one request and no automatic retry or token increase',async()=>{
 const {ai,calls}=fixture('length');await assert.rejects(ai.chat({principal,ip:'synthetic-ip',input:{model:targetIds[0],messages,max_tokens:700}}),e=>e.status===502&&e.code==='UPSTREAM_INCOMPLETE');assert.equal(calls.length,1);assert.equal(calls[0].body.max_tokens,700);assert.deepEqual(calls[0].body.thinking,{type:'disabled'});assert.equal(ai.usage(principal).requestsUsed,1);assert.equal(ai.globalActive,0);
});
