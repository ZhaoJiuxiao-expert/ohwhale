import {PublicPeerSession} from './network.js';
let session,label='',remoteLabel='',received=0,acks=0,probeId='';const $=id=>document.getElementById(id);
const state=value=>$('status').textContent=JSON.stringify(value,null,2);
function make(serverUrl=location.origin,ownerToken=''){
 session?.close();return session=new PublicPeerSession({serverUrl,ownerToken,iceTransportPolicy:'relay',onState:state,onError:e=>state({error:e.message,code:e.code}),onMessage:async message=>{
  if(message.type!=='chat')return;if(message.text.startsWith('OHQA_PROBE:')){let data;try{data=JSON.parse(message.text.slice('OHQA_PROBE:'.length));}catch{return;}if(typeof data.id!=='string'||data.id.length>100)return;received++;remoteLabel=String(data.label||'').slice(0,100);await session.send({type:'chat',id:crypto.randomUUID(),text:'OHQA_ACK:'+data.id}).catch(()=>{});}
  if(message.text==='OHQA_ACK:'+probeId)acks++;
 }});
}
async function create({ownerToken,environmentLabel}){label=String(environmentLabel||'').slice(0,100);if(!label)throw Error('请填写实际测试环境');const result=await make(location.origin,ownerToken).create({name:label,mode:'human'});$('code').value=result.code;return {code:result.code};}
async function join({code,environmentLabel}){label=String(environmentLabel||'').slice(0,100);if(!label)throw Error('请填写实际测试环境');return make('').join(code,{name:label});}
async function probe(){probeId=crypto.randomUUID();await session.send({type:'chat',id:crypto.randomUUID(),text:'OHQA_PROBE:'+JSON.stringify({id:probeId,label})});}
async function report(){const diagnostics=await session.diagnostics();return {at:new Date().toISOString(),scope:'operator-declared environments; independent network evidence required separately',environmentLabel:label,remoteEnvironmentLabel:remoteLabel,receivedProbes:received,acknowledgedProbes:acks,transport:diagnostics,relayTransportVerified:diagnostics.route==='relay'&&diagnostics.iceTransportPolicy==='relay'&&acks>0&&Number(diagnostics.bytesSent)>0&&Number(diagnostics.bytesReceived)>0};}
window.p2pQa={create,join,probe,report,connected:()=>!!session?.info.connected};
for(const [id,fn]of [['create',()=>create({ownerToken:$('token').value,environmentLabel:$('label').value})],['join',()=>join({code:$('code').value,environmentLabel:$('label').value})],['probe',probe],['export',async()=>{$('result').textContent=JSON.stringify(await report(),null,2);} ],['close',()=>session?.close()]])$(id).onclick=()=>Promise.resolve().then(fn).catch(e=>state({error:e.message}));
