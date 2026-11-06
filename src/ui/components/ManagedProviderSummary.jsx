import React,{useEffect,useState} from 'react';
import {ShieldCheck,RefreshCw} from 'lucide-react';
export default function ManagedProviderSummary({provider}){
 const [usage,setUsage]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){setBusy(true);setError('');try{setUsage(await window.ly.managedUsage());}catch(e){setError(e.message||'暂时没读到剩余次数，稍后再看看呀。');}finally{setBusy(false);}}
 useEffect(()=>{refresh();},[provider.id]);
 return <section className="provider-form managed-provider-summary"><h3><ShieldCheck size={19}/> 小鲸托管的国产模型</h3><p>{provider.name}</p><strong>{provider.model}</strong><p>已经接好啦，不用填写 API Key。聊天会经过哦鲸鲸的香港服务器和 AtlasCloud，再由所选模型处理；上游处理地点尚未核实。</p>
 {usage&&<div className="info-note"><span>今天还可以聊 <strong>{usage.requestsRemaining}</strong> 次 · 每分钟最多 {usage.perMinute} 次 · 同时 1 条。<br/>每日额度按 UTC 日期重置；服务器总额度用完时也会暂歇。</span></div>}
 {error&&<p role="alert">{error}</p>}<button type="button" className="outline-button" onClick={refresh} disabled={busy}><RefreshCw size={15}/>{busy?'正在看看…':'看看剩余次数'}</button>
 <p className="fine-print">想换模型？打开角色聊天，点击顶部的模型名称。境外模型可以在“自己的 API”里连接；密钥保存在你的设备上。</p></section>;
}
