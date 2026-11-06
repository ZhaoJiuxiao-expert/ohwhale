import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Check,ChevronRight,LoaderCircle,ShieldCheck,SlidersHorizontal,Sparkles,KeyRound,RefreshCw} from 'lucide-react';
import './ConnectionGuide.css';

function catalogValue(value){
 if(!value||typeof value!=='object'||typeof value.enabled!=='boolean'||!Array.isArray(value.models)||value.models.length>128)throw Error('模型小菜单还没读完整，再刷新一下呀。');
 const seen=new Set();const models=value.models.map(model=>{if(!model||typeof model.id!=='string'||model.id.length>160||!model.id.length||/[\s\x00-\x1f]/.test(model.id)||typeof model.name!=='string'||!model.name.trim()||model.name.length>100||typeof model.vision!=='boolean'||seen.has(model.id))throw Error('模型小菜单格式不完整，请稍后再来呀。');seen.add(model.id);return {id:model.id,name:model.name,vision:model.vision};});
 const limits=value.limits||{};if(value.enabled&&(!models.length||!['perMinute','perDay','concurrent'].every(k=>Number.isInteger(limits[k])&&limits[k]>0)))throw Error('服务的可用模型和用量说明还没准备齐，请稍后再试呀。');
 return {enabled:value.enabled,models,limits};
}
function explanation(error){return typeof error?.message==='string'?error.message.slice(0,300):'这一步还没接上，再试一次呀。';}
export default function ConnectionGuide({agent,state,onRefresh,onClose,onError}){
 const available=state.providers.filter(p=>(p.managed||p.hasKey)&&p.consent);
 const [tab,setTab]=useState('managed'),[ownMode,setOwnMode]=useState(available.length?'choose':'new'),[selected,setSelected]=useState(available[0]?.id||''),[busy,setBusy]=useState(false),[form,setForm]=useState({name:'',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:'',vision:false,consent:false}),[error,setError]=useState(''),[catalog,setCatalog]=useState(null),[catalogError,setCatalogError]=useState(''),[catalogLoading,setCatalogLoading]=useState(true),[managedModel,setManagedModel]=useState(''),[managedConsent,setManagedConsent]=useState(false);
 const alive=useRef(true),loading=useRef(false),connecting=useRef(false);
 const loadCatalog=useCallback(async()=>{
  if(loading.current)return;loading.current=true;if(alive.current){setCatalogLoading(true);setCatalogError('');setManagedConsent(false);}
  try{if(typeof window.ly.managedCatalog!=='function')throw Error('这一版还没接上免填密钥服务，可以先使用自己的 API 呀。');const value=catalogValue(await window.ly.managedCatalog());if(!alive.current)return;setCatalog(value);setManagedModel(previous=>value.models.some(model=>model.id===previous)?previous:(value.models.find(model=>/deepseek/i.test(model.id+' '+model.name))?.id||value.models[0]?.id||''));}
  catch(e){if(alive.current){setCatalog(null);setCatalogError(explanation(e));}}
  finally{loading.current=false;if(alive.current)setCatalogLoading(false);}
 },[]);
 useEffect(()=>{alive.current=true;loadCatalog();return()=>{alive.current=false;};},[loadCatalog]);
 const selectedManaged=catalog?.models.find(model=>model.id===managedModel),managedReady=catalog?.enabled===true&&!catalogLoading&&Boolean(selectedManaged);
 const existingProvider=available.find(provider=>provider.id===selected),existingManagedReady=!existingProvider?.managed||(catalog?.enabled===true&&!catalogLoading&&catalog.models.some(model=>model.id===existingProvider.model));
 const canConnect=tab==='managed'?managedReady&&managedConsent:ownMode==='new'?form.consent:Boolean(existingProvider)&&existingManagedReady;
 async function connect(event){
  event?.preventDefault();if(connecting.current)return;connecting.current=true;setBusy(true);setError('');
  try{
   if(tab==='managed'){
    if(!managedReady||!catalog.models.some(model=>model.id===managedModel))throw Error('免填密钥服务暂时还没准备好，请刷新小菜单，或切换到自己的 API。');
    if(!managedConsent)throw Error('先读一读下面的使用说明，再勾选同意呀。');
    await window.ly.managedConnect({agentId:agent.id,model:managedModel,consent:true});
   }else{
    let providerId=selected;
    if(ownMode==='new'){if(!form.consent)throw Error('先确认这个服务的使用说明呀。');providerId='provider-'+crypto.randomUUID();await window.ly.saveProvider({...form,id:providerId});}
    else{if(!existingProvider)throw Error('先选一个已经接好的服务呀。');if(existingProvider.managed&&!existingManagedReady)throw Error('这个托管模型暂时不能用，请刷新国产模型小菜单，或选择自己的 API。');}
    if(!providerId)throw Error('先选一个模型服务，再让角色开口吧。');await window.ly.saveAgent({...agent,providerId});
   }
   await onRefresh();if(alive.current)onClose({connected:true});
  }catch(e){if(alive.current)setError(explanation(e));onError?.(e);}
  finally{connecting.current=false;if(alive.current)setBusy(false);}
 }
 return <div className="connection-guide" data-testid="connection-guide">
  <div className="connection-steps"><span><Check size={13}/>选好角色</span><i/><strong><SlidersHorizontal size={14}/>接上模型</strong><i/><span>开始聊天</span></div>
  <p className="connection-welcome">{agent.name}的性格已经准备好啦。选一个模型，就能回应你的话。<br/><small>角色的人设与实际模型分开配置；角色叫什么名字，不会替你切换服务。</small></p>
  <div className="connection-route-tabs" aria-label="模型接入方式"><button type="button" className={tab==='managed'?'selected':''} aria-pressed={tab==='managed'} disabled={busy} onClick={()=>{setTab('managed');setError('');}} data-testid="connect-route-managed"><Sparkles size={16}/><span>直接聊 · 国产模型</span></button><button type="button" className={tab==='own'?'selected':''} aria-pressed={tab==='own'} disabled={busy} onClick={()=>{setTab('own');setError('');}} data-testid="connect-route-own"><KeyRound size={16}/><span>自己的 API</span></button></div>
  <form onSubmit={connect}>
   {tab==='managed'?<section className="managed-connect-section" aria-label="免填密钥的国产模型">
    <div className="managed-intro"><span aria-hidden="true">🐋</span><div><strong>不用找密钥，选好就能聊</strong><p>国内研发的模型，由哦鲸鲸服务接好。你也可以在另一页使用自己的国内或海外模型接口。</p></div></div>
    {catalogLoading?<p className="managed-catalog-status" role="status"><LoaderCircle size={16} className="spin"/>正在看看哪些模型可以陪你聊……</p>:catalogError?<div className="managed-unavailable" role="alert"><p>{catalogError}</p><button type="button" onClick={loadCatalog} disabled={busy}><RefreshCw size={14}/>再看看</button></div>:!catalog?.enabled?<div className="managed-unavailable" role="status"><p>免填密钥服务还在准备中，这会儿先不能直接开聊。你可以刷新看看，或使用自己的 API。</p><button type="button" onClick={loadCatalog} disabled={busy}><RefreshCw size={14}/>刷新可用状态</button></div>:null}
    <label className="field"><span>这次想和哪个模型聊？</span><select value={managedModel} onChange={event=>{setManagedModel(event.target.value);setManagedConsent(false);}} disabled={!catalog?.enabled||catalogLoading||busy} data-testid="connect-managed-model" aria-label="托管国产模型">{!catalog?.models.length&&<option value="">等模型小菜单准备好</option>}{catalog?.models.map(model=><option key={model.id} value={model.id}>{model.name}{model.vision?' · 可以看图':''}</option>)}</select>{selectedManaged&&<small data-testid="connect-managed-model-id">实际模型：{selectedManaged.id}{selectedManaged.vision?'；支持图片理解。':'；当前仅支持文字，请换支持看图的模型再发图片。'}</small>}</label>
    {catalog?.enabled&&<div className="managed-limits" data-testid="connect-managed-limits"><strong>一起留点聊天余量呀</strong><span>每人每分钟最多 {catalog.limits.perMinute} 次，每天最多 {catalog.limits.perDay} 次，同一时刻最多 {catalog.limits.concurrent} 个请求。</span><small>每天按 UTC 0 点更新（北京时间早上 8 点）；服务总额度或繁忙程度也可能影响可用性。</small></div>}
    <label className="check-label managed-consent"><input type="checkbox" checked={managedConsent} onChange={event=>setManagedConsent(event.target.checked)} disabled={!managedReady||busy} data-testid="connect-managed-consent"/><span>我同意把本次聊天文字、图片及相关已确认记忆，经<strong>哦鲸鲸香港服务器</strong>发送给 <strong>AtlasCloud</strong> 使用所选模型。如本机还没有身份卡，同意自动创建“一位鲸友”的设备身份用于识别用量；这不会自动添加好友。<small>“国产模型”不代表数据只在中国大陆处理。上游具体处理地点尚未核实，API 用量由本服务承担。</small></span></label>
   </section>:<>
    <p className="own-api-note">已有服务可以继续用。海外模型请填写你自己的 API；模型费用由你选择的服务商计算。</p>
    {available.length>0&&<div className="settings-tabs"><button type="button" className={ownMode==='choose'?'selected':''} disabled={busy} onClick={()=>{setOwnMode('choose');setError('');}}>用已有服务</button><button type="button" className={ownMode==='new'?'selected':''} disabled={busy} onClick={()=>{setOwnMode('new');setError('');}}>添加新服务</button></div>}
    {ownMode==='choose'?<label className="field"><span>让角色使用哪个模型？</span><select value={selected} onChange={event=>setSelected(event.target.value)} disabled={busy} data-testid="connect-provider">{available.map(provider=><option value={provider.id} key={provider.id}>{provider.managed?'哦鲸鲸托管 · ':''}{provider.name} · {provider.model}</option>)}</select><small>你可以随时更换。已有的授权不会自动扩大到朋友共享。</small>{existingProvider?.managed&&!existingManagedReady&&<span className="guide-error" role="alert">这个托管模型还没有通过可用检查。请到“直接聊 · 国产模型”刷新，或选择自己的 API。</span>}</label>:<>
     <div className="guide-two-fields"><label className="field"><span>服务名称</span><input required value={form.name} maxLength={100} onChange={event=>setForm(value=>({...value,name:event.target.value}))} placeholder="例如：我的模型服务" data-testid="connect-name" disabled={busy}/></label><label className="field"><span>模型名称</span><input required value={form.model} maxLength={160} onChange={event=>setForm(value=>({...value,model:event.target.value}))} data-testid="connect-model" disabled={busy}/></label></div>
     <label className="field"><span>API 基础地址</span><input required value={form.baseUrl} onChange={event=>setForm(value=>({...value,baseUrl:event.target.value}))} data-testid="connect-url" disabled={busy}/><small>兼容 OpenAI Chat Completions 的 HTTPS 地址；桌面也可使用本机模型服务。</small></label>
     <label className="field"><span>API Key</span><input required type="password" autoComplete="off" value={form.apiKey} onChange={event=>setForm(value=>({...value,apiKey:event.target.value}))} placeholder="粘贴服务商提供的 API Key" data-testid="connect-key" disabled={busy}/><small>只在当前设备保存，不会放进角色卡或发给朋友。</small></label>
     <label className="check-label"><input type="checkbox" checked={form.vision} onChange={event=>setForm(value=>({...value,vision:event.target.checked}))} disabled={busy}/>这个模型支持图片理解（按服务商实际能力选择）</label>
     <label className="check-label"><input type="checkbox" checked={form.consent} onChange={event=>setForm(value=>({...value,consent:event.target.checked}))} data-testid="connect-consent" disabled={busy}/>我同意向这个服务发送聊天内容，并承担它产生的 API 用量。</label>
    </>}
   </>}
   {error&&<p className="guide-error" role="alert">这一步还没完成：{error}</p>}
   <div className="guide-privacy"><ShieldCheck size={16}/><span>接好模型后才会发送聊天请求。现在写的草稿会好好留在这里。</span></div>
   <footer><button type="button" className="outline-button" onClick={()=>onClose()} disabled={busy}>暂时先看看</button><button className="primary-button" type="submit" disabled={busy||!canConnect} data-testid="connect-confirm">{busy?<LoaderCircle size={16} className="spin"/>:<ChevronRight size={16}/>}接好模型，开始聊天</button></footer>
  </form>
 </div>;
}
