import React,{useEffect,useRef,useState} from 'react';
import {LoaderCircle,RefreshCw,Check,Sparkles,ChevronDown} from 'lucide-react';
import './quick-setup.css';
import AgreementLink from './AgreementLink';

export default function QuickSetup({agentIds,state,onDone,onAdvanced,onRefresh}){
 const [plan,setPlan]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[mode,setMode]=useState('suggested'),[providerId,setProviderId]=useState('');const alive=useRef(true),guard=useRef(false);
 async function load(){setLoading(true);setError('');setConsent(false);try{const p=await window.ly.housePlan({agentIds});if(!alive.current)return;setPlan(p);setProviderId(p.providers[0]?.id||'');if(p.assignments.some(a=>!a.ready&&!a.model)&&p.providers.length)setMode('existing');}catch(e){if(alive.current)setError(e.message)}finally{if(alive.current)setLoading(false)}}
 useEffect(()=>{alive.current=true;load();return()=>{alive.current=false}},[agentIds.join('|')]);
 const pending=plan?.assignments.filter(a=>!a.ready)||[],suggestedReady=plan&&pending.every(a=>a.model),existingReady=plan?.providers.some(p=>p.id===providerId);
 async function connect(){if(guard.current)return;guard.current=true;setBusy(true);setError('');try{await window.ly.houseConnect({agentIds,mode,providerId:mode==='existing'?providerId:undefined,assignments:mode==='suggested'?plan.assignments.map(a=>({agentId:a.agentId,model:a.model})):undefined,consent:true});await onRefresh();if(alive.current)onDone();}catch(e){await onRefresh();if(alive.current)setError(e.message+' 已接好的伙伴会保留，不需要重填。')}finally{guard.current=false;if(alive.current)setBusy(false)}}
 return <section className="quick-setup" data-testid="house-setup"><div className="quick-setup-welcome"><span>🐋</span><div><h3>把她们的声音接进小屋</h3><p>性格都准备好啦，不用逐个填写地址和密钥。</p></div></div>{loading?<p role="status"><LoaderCircle className="spin" size={16}/> 正在看看谁已经准备好了…</p>:plan&&<>
 <div className="quick-setup-people">{plan.assignments.map(a=><div key={a.agentId}><img src={state.agents.find(x=>x.id===a.agentId)?.avatar||'assets/deepseek-avatar.png'} alt=""/><span><strong>{a.name}</strong><small>{a.ready?'已准备好 · 保留原来的连接':a.model?(a.fallback?'由 '+a.modelName+' 演绎，保留角色性格':a.modelName):'还需要一份聊天连接'}</small></span>{a.ready&&<Check size={18}/>}</div>)}</div>
 {!pending.length?<button className="primary-button full" onClick={onDone}>都在啦，开始聊天</button>:<>
 {plan.providers.length>0&&<div className="quick-setup-routes"><button className={mode==='suggested'?'active':''} onClick={()=>{setMode('suggested');setConsent(false)}} disabled={busy}>用小屋准备好的</button><button className={mode==='existing'?'active':''} onClick={()=>{setMode('existing');setConsent(false)}} disabled={busy}>沿用我的连接</button></div>}
 {mode==='existing'&&<label>用哪份连接陪大家聊？<select value={providerId} onChange={e=>{setProviderId(e.target.value);setConsent(false)}} disabled={busy}>{plan.providers.map(p=><option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>}
 {mode==='suggested'&&plan.catalogError&&<p role="status">{plan.catalogError}</p>}
 {mode==='suggested'&&!suggestedReady&&<p>有伙伴还没找到合适的连接，可以刷新小菜单，或到更多设置里接上自己的服务。</p>}
 <details><summary><ChevronDown size={14}/> 连接与聊天余量</summary>{plan.assignments.map(a=><p key={a.agentId}>{a.name}：{a.ready||mode==='suggested'?a.model||'尚未连接':plan.providers.find(p=>p.id===providerId)?.model}</p>)}{plan.limits&&<p>每分钟最多 {plan.limits.perMinute} 次、每天 {plan.limits.perDay} 次。三位一起回复会用三次；也可以只点一位。</p>}</details>
 <label className="quick-setup-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy}/><span>{mode==='suggested'?'同意将聊天经香港服务器交给 AtlasCloud 所选模型处理，并建立设备身份记录用量。上游处理地点尚未核验。':'同意将聊天交给上面所选连接的服务商处理。'}<small>只有你选好的小屋标注会随聊天发送，完整模型文件不会上传。更多说明见用户协议。</small></span></label>
 <button className="primary-button full" data-testid="house-connect" onClick={connect} disabled={busy||!consent||!(mode==='suggested'?suggestedReady:existingReady)}>{busy?<LoaderCircle className="spin" size={18}/>:<Sparkles size={18}/>} {busy?'正在接她们回家…':'接好啦，就开聊'}</button></>}
 </>}{error&&<p role="alert" className="quick-setup-error">{error}</p>}<AgreementLink/><footer><button onClick={load} disabled={loading||busy}><RefreshCw size={14}/> 再看看</button><button onClick={onAdvanced} disabled={busy}>更多连接设置</button></footer></section>;
}
