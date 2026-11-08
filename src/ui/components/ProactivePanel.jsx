import React, {useCallback, useEffect, useState} from 'react';
import {Bell, Clock3, RefreshCw, ShieldCheck} from 'lucide-react';

const labels={sent:'今天的小心意已送到',success:'今天的小心意已送到',failed:'暂时没送到，会按间隔再试',retry:'等一会儿再试','retry-wait':'等一会儿再试',waiting:'等合适的时候',idle:'等合适的时候',due:'等下一个合适的时机',disabled:'暂时安静陪着你',suppressed:'这次先不打扰',busy:'正在准备一句问候',pending:'正在准备一句问候',attempt:'正在准备一句问候',prepared:'问候写好了，等合适的时候送达',limit:'今天先好好休息',exhausted:'今天尝试已到上限','paused-today':'今天尝试已到上限',quiet:'现在是免打扰时间','quiet-hours':'现在是免打扰时间','not-due':'还没到约定的时间','recent-chat':'刚聊过，先留一点自己的时间','giving-space':'等你想聊时，再接着说','waiting-for-you':'等你回来，再聊新鲜事','stale-plan':'打开应用，更新伙伴的小日程','not-ready':'还需要接好模型服务','similar-reply-skipped':'这次太像之前的话，先不重复打扰'};
const reasons={'rate-limit':'模型服务有点忙，会晚些再试。','duplicate':'这句和最近的话太像，今天先不重复啦。','invalid-length':'这次回复没有整理好，今天先不打扰。','schedule-changed':'设置已经变更，这次问候已收好。','interaction-cooldown':'刚刚聊过，先留一点自己的时间。','unanswered-cooldown':'你还没有回复，伙伴会少来打扰。','waiting-for-you':'等你回来聊聊，再接着问候。','already-sent':'今天已经问候过啦。','provider-unavailable':'先为这位伙伴接好并授权模型服务吧。','all-conversations-archived':'这位伙伴的聊天已归档，问候暂停。','quiet-hours':'现在是免打扰时间。','delivery-pending':'问候已保存，等恢复后送达，不会重新生成。','plugin-disabled':'主动问候插件已暂停。','attempt-limit':'今天的尝试次数已用完，明天再来。','backoff':'给模型服务一点时间，稍后再试。'};
const reasonText=value=>reasons[value]||(/[\u3400-\u9fff]/.test(value||'')?value:value?'暂时还没准备好，稍后再来看看。':'');
const clock=value=>{if(!value)return '';const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';};

export default function ProactivePanel({state,runtime,run,refresh,toast}){
 const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[failure,setFailure]=useState('');
 const load=useCallback(async()=>{
  try{if(!window.ly.proactiveStatus){setFailure('这一版还没有连接问候服务，请更新应用后再来。');return;}
   const value=await window.ly.proactiveStatus();setStatus(value);setFailure('');
  }catch{setFailure('暂时没读到问候状态，点刷新再试试吧。');}
 },[]);
 useEffect(()=>{load();const timer=setInterval(load,15000);return()=>clearInterval(timer);},[load,state.agents,state.plugins?.settings?.proactive]);
 const configure=async background=>{setBusy(true);try{await run(async()=>{
  const value=await window.ly.proactiveConfigure({background});setStatus(value);await refresh();setConsent(false);
  toast(value.backgroundEnabled?'后台小问候打开啦，通知会轻轻提醒你。':background?'通知还没有开启，问候仍可在打开应用时查看。':'后台问候暂停啦。');
 });await load();}finally{setBusy(false);}};
 const mobile=runtime.platform==='android';
 return <section className="proactive-panel" data-testid="proactive-panel">
  <header><Bell size={20}/><div><h3>让伙伴偶尔来找你</h3><p>记得你说过的小事，也给你安心独处的时间。</p></div></header>
  <p className="proactive-description">在「角色与人设」里为喜欢的伙伴开启问候，选择固定时间或自然节奏。每位伙伴每天最多主动发一条；刚聊完先缓一缓，连续没回复时也会少来打扰。</p>
  {mobile?<>
   <div className="proactive-background-state"><strong>{status?.backgroundEnabled?'后台问候已开启':'后台问候未开启'}</strong><span>{status?.notificationsAllowed?'通知已允许':status?'通知尚未允许':'正在读状态…'}</span></div>
   {!status?.backgroundEnabled&&<label className="check-label proactive-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} data-testid="background-greeting-consent"/>我同意在应用后台时，使用已授权模型和额度，发送角色设定、已确认的记忆及近期对话来生成问候。</label>}
   <div className="proactive-actions"><button type="button" className="primary-button" disabled={busy||!status?.supported||(!status?.backgroundEnabled&&!consent)} onClick={()=>configure(!status?.backgroundEnabled)} data-testid="background-greeting-toggle">{busy?'稍等，小鲸在整理…':status?.backgroundEnabled?'暂停后台问候':'允许后台小问候'}</button><button type="button" className="text-button" onClick={()=>run(()=>window.ly.proactiveOpenSettings())}>查看系统通知设置</button></div>
   <p className="fine-print"><Clock3 size={14}/>后台由手机系统安排执行，可能延后；强制停止应用后需重新打开。通知默认不展示聊天正文。小米的省电限制也可能推迟问候。</p>
  </>:<div className="info-note"><Clock3 size={17}/><span>电脑上保持哦鲸鲸运行或最小化即可；退出后暂停。再次打开时，只补今天合适时段的一条，不堆积往日消息。</span></div>}
  <div className="proactive-status-heading"><strong>伙伴的小日程</strong><button type="button" className="text-button" onClick={load} data-testid="refresh-proactive"><RefreshCw size={14}/>刷新状态</button></div>
  {(failure||status?.reason)&&<p role="status" className="proactive-error">{failure||reasonText(status.reason)}</p>}
  {state.plugins?.settings?.proactive===false&&<p className="proactive-error">「插件与记忆」里的主动问候已暂停，打开后伙伴才会来问好。</p>}
  <div className="proactive-status-list">{state.agents.filter(a=>a.greeting?.enabled).map(agent=>{
   const row=status?.agents?.find(x=>x.agentId===agent.id)||{};
   return <article key={agent.id}><div><strong>{agent.name}</strong><small>{agent.greeting.mode==='natural'?'自然节奏':'固定时间'} · {String(agent.greeting.hour).padStart(2,'0')}:00 起</small></div><div><span>{row.attempts>=3&&row.status==='failed'?'今天尝试已到上限':labels[row.status]||'等合适的时候'}</span>{row.nextAttemptAt&&row.attempts<3&&<small>下次检查不早于 {clock(row.nextAttemptAt)}</small>}{row.lastSentAt&&<small>上次送达 {clock(row.lastSentAt)}</small>}{row.attempts>0&&<small>今天尝试 {row.attempts}/3 次</small>}{row.reason&&<small>{reasonText(row.reason)}</small>}</div></article>;
  })}</div>
  {!state.agents.some(a=>a.greeting?.enabled)&&<p className="inline-empty">还没有伙伴开启问候。去「角色与人设」挑一位吧。</p>}
  <p className="fine-print"><ShieldCheck size={14}/>到时才调用模型；失败会限次重试，关闭角色问候即可停止。记忆仍由你选择保存，不会暗中观察你的生活。</p>
 </section>;
}
