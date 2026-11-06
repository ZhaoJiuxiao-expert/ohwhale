import React,{useCallback,useEffect,useRef,useState} from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {Users,UserPlus,QrCode,Camera,Image as ImageIcon,Copy,Check,X,MessageCircle,RefreshCw,LoaderCircle,ShieldCheck,ChevronRight,PhoneIncoming,ScanLine,SlidersHorizontal} from 'lucide-react';
import {normalizeFriendCode,friendQRPayload,parseFriendQR} from './friend-code.cjs';
import './FriendsPanel.css';

const emptyState={contacts:[],requests:{incoming:[],outgoing:[]},calls:[]};
const POLL_MS=5000;
function friendlyError(error){return typeof error?.message==='string'?error.message.slice(0,240):'这一步还没接上，再试一次呀。';}
function shortName(name){return Array.from(name||'鲸')[0];}
function Person({person,children}){return <div className="friend-person"><span className="friend-avatar" aria-hidden="true">{shortName(person.name)}</span><div className="friend-person-text"><strong>{person.name}</strong><small>{person.code}</small>{children}</div></div>;}

export default function FriendsPanel({onConnect,onClose,onAdvanced,connected=false,onBlocked}){
 const [local,setLocal]=useState(null),[state,setState]=useState(emptyState),[tab,setTab]=useState('friends'),[name,setName]=useState(''),[consent,setConsent]=useState(false),[code,setCode]=useState(''),[qr,setQr]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[checking,setChecking]=useState(true),[camera,setCamera]=useState(false),[cameraError,setCameraError]=useState(''),[blockTarget,setBlockTarget]=useState(null);
 const alive=useRef(true),pollBusy=useRef(false),actionBusy=useRef(false),video=useRef(null),stream=useRef(null),scanTimer=useRef(null),cameraGeneration=useRef(0),fileInput=useRef(null),handled=useRef(new Set()),intent=useRef(new Set()),connectBusy=useRef(false),onConnectRef=useRef(onConnect),selfRef=useRef(null);
 onConnectRef.current=onConnect;selfRef.current=state.self||local?.self;
 const stopCamera=useCallback(()=>{cameraGeneration.current++;if(scanTimer.current)clearTimeout(scanTimer.current);scanTimer.current=null;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;if(video.current)video.current.srcObject=null;if(alive.current)setCamera(false);},[]);
 const refresh=useCallback(async()=>{
  if(pollBusy.current)return null;pollBusy.current=true;
  try{const next=await window.ly.friendsState();if(alive.current)setState(next);return next;}finally{pollBusy.current=false;}
 },[]);
 const load=useCallback(async()=>{
  if(alive.current){setChecking(true);setError('');}
  try{const status=await window.ly.friendsStatus();if(!alive.current)return;setLocal(status);if(status.error){setError(friendlyError({message:status.error}));return;}if(status.enabled)await refresh();}
  catch(e){if(alive.current)setError(friendlyError(e));}
  finally{if(alive.current)setChecking(false);}
 },[refresh]);
 useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;stopCamera();};},[load,stopCamera]);
 useEffect(()=>{
  if(!local?.enabled||local.error)return;
  let disposed=false,timer,polling=false;
  const poll=async()=>{if(disposed||polling)return;polling=true;try{if(document.visibilityState!=='hidden')await refresh();}catch(e){if(!disposed&&alive.current)setError(friendlyError(e));}finally{polling=false;clearTimeout(timer);if(!disposed)timer=setTimeout(poll,POLL_MS);}};
  const visible=()=>{if(document.visibilityState!=='hidden'){clearTimeout(timer);poll();}else stopCamera();};
  timer=setTimeout(poll,POLL_MS);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
 },[local?.enabled,local?.error,refresh,stopCamera]);
 useEffect(()=>{
  let cancelled=false;setQr('');const ownCode=local?.self?.code;
  if(ownCode)QRCode.toDataURL(friendQRPayload(ownCode),{width:600,margin:4,errorCorrectionLevel:'M',color:{dark:'#173559',light:'#ffffff'}}).then(value=>{if(!cancelled)setQr(value);}).catch(e=>{if(!cancelled)setError(friendlyError(e));});
  return()=>{cancelled=true;};
 },[local?.self?.code]);
 useEffect(()=>{if(tab!=='add')stopCamera();},[tab,stopCamera]);
 async function action(key,fn){
  if(actionBusy.current)return;actionBusy.current=true;setBusy(key);setError('');setNotice('');
  try{return await fn();}catch(e){if(alive.current)setError(friendlyError(e));}finally{actionBusy.current=false;if(alive.current)setBusy('');}
 }
 async function connectCall(callId){
  if(connected){setError('已经在和一位朋友聊天啦，请先断开当前连接，再接上另一位。');return;}
  if(connectBusy.current||handled.current.has(callId))return;connectBusy.current=true;handled.current.add(callId);setError('');setBusy('connect:'+callId);
  try{const grant=await window.ly.friendsSession({callId});if(alive.current)await onConnectRef.current({...grant,callId,self:selfRef.current});}
  catch(e){intent.current.delete(callId);handled.current.delete(callId);if(alive.current)setError(friendlyError(e));}
  finally{connectBusy.current=false;if(alive.current)setBusy('');}
 }
 useEffect(()=>{const accepted=state.calls?.find(call=>call.status==='accepted'&&intent.current.has(call.id)&&!handled.current.has(call.id));if(accepted&&!connected)connectCall(accepted.id);},[state.calls,connected]);
 async function enable(event){event.preventDefault();await action('enable',async()=>{const next=await window.ly.friendsEnable({name:name.trim(),consent});if(!alive.current)return;setLocal(next);setTab('mine');await refresh();setNotice('你的鲸鲸号准备好啦，快邀请朋友来玩。');});}
 async function request(event){event.preventDefault();await action('request',async()=>{const normalized=normalizeFriendCode(code);if(normalized===local?.self?.code)throw Error('这是你自己的鲸鲸号呀，试试朋友的那一串。');await window.ly.friendsRequest({code:normalized});setCode(normalized);await refresh();setNotice('招呼送到啦，等对方确认后就会出现在好友列表。');setTab('friends');});}
 async function callFriend(friend){if(connected)return;await action('call:'+friend.id,async()=>{const result=await window.ly.friendsCall({friendId:friend.id});intent.current.add(result.callId);await refresh();setNotice('正在轻轻敲门，等 '+friend.name+' 接听呀。');});}
 async function respondCall(call,accept){if(accept&&connected)return;await action('respond-call:'+call.id,async()=>{if(accept)intent.current.add(call.id);await window.ly.friendsRespondCall({callId:call.id,accept});await refresh();if(!accept)setNotice('这次先不接啦。');});}
 async function copy(value){await action('copy',async()=>{await window.ly.copyText({text:value});setNotice('已经复制好啦，发给朋友就能找到你。');});}
 function scanned(text){const parsed=parseFriendQR(text);setCode(parsed);setTab('add');setNotice('认出好友码啦：'+parsed+'。核对后点“发送好友申请”。');setError('');stopCamera();}
 async function readQrImage(event){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;stopCamera();setCameraError('');
  await action('scan-image',async()=>{
   if(file.size>10*1024*1024||!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type))throw Error('选一张 10MB 以内的二维码图片吧（PNG、JPG、WebP 或 GIF）。');
   const url=URL.createObjectURL(file);try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('这张图片暂时打不开，换一张试试呀。'));img.src=url;});
    if(!alive.current)return;if(!img.naturalWidth||!img.naturalHeight)throw Error('图片好像是空的，再选一张呀。');
    const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(img,0,0,canvas.width,canvas.height);const frame=context.getImageData(0,0,canvas.width,canvas.height),result=jsQR(frame.data,frame.width,frame.height,{inversionAttempts:'attemptBoth'});if(!result)throw Error('还没找到二维码，选一张更清楚、四周完整的图片呀。');scanned(result.data);
   }finally{URL.revokeObjectURL(url);}
  });
 }
 async function startCamera(){
  stopCamera();setCameraError('');setError('');setCamera(true);const generation=++cameraGeneration.current;
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('这台设备暂时不能直接扫码，可以选二维码图片，或者输入鲸鲸号呀。');
   const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
   if(!alive.current||generation!==cameraGeneration.current){media.getTracks().forEach(track=>track.stop());return;}stream.current=media;
   const canvas=document.createElement('canvas');const context=canvas.getContext('2d',{willReadFrequently:true});
   const scan=()=>{
    if(!alive.current||generation!==cameraGeneration.current)return;
    const view=video.current;if(view&&view.srcObject!==media){view.srcObject=media;view.play().catch(()=>{});}
    if(view?.readyState>=2&&view.videoWidth){const scale=Math.min(1,960/view.videoWidth);canvas.width=Math.round(view.videoWidth*scale);canvas.height=Math.round(view.videoHeight*scale);context.drawImage(view,0,0,canvas.width,canvas.height);const frame=context.getImageData(0,0,canvas.width,canvas.height),result=jsQR(frame.data,frame.width,frame.height,{inversionAttempts:'dontInvert'});if(result){try{scanned(result.data);}catch(e){stopCamera();setCameraError(friendlyError(e));}return;}}
    scanTimer.current=setTimeout(scan,220);
   };scan();
  }catch(e){if(alive.current&&generation===cameraGeneration.current){stopCamera();setCameraError(e?.name==='NotAllowedError'?'相机还没获得许可。可以在系统设置里允许，或直接选择二维码图片呀。':friendlyError(e));}}
 }
 const incoming=state.requests?.incoming||[],outgoing=state.requests?.outgoing||[],contacts=state.contacts||[],calls=state.calls||[],self=state.self||local?.self;
 const disabled=Boolean(busy),activeCall=calls.length>0;
 return <section className="friends-panel" data-testid="friends-panel" aria-label="好友">
  <header className="friends-heading"><div><h2><Users size={23}/>来交个朋友</h2><p>扫一扫，或记住一串鲸鲸号。</p></div>{onClose&&<button type="button" className="friend-icon-button" aria-label="关闭好友" onClick={()=>{stopCamera();onClose();}}><X size={21}/></button>}</header>
  {error&&<div className="friends-error" role="alert">{error}<button type="button" onClick={()=>action('refresh',load)} disabled={disabled}>重新试试</button></div>}
  {notice&&<p className="friends-notice" role="status"><Check size={16}/>{notice}</p>}
  {checking&&!local?<div className="friends-empty"><LoaderCircle className="friend-spin"/><p>正在找回你的好友小卡片……</p></div>:!local?<div className="friends-empty"><p>还没读到本机资料，点“重新试试”就好啦。</p></div>:local.error?<div className="friends-empty"><ShieldCheck size={28}/><h3>先把本机身份卡照顾好</h3><p>已有资料会保留。身份卡修复前，暂时不能创建新号码，免得找不到原来的好友。</p></div>:!local.enabled?<form className="friend-onboard" onSubmit={enable}>
   <span className="friend-welcome-icon" aria-hidden="true">🐋</span><h3>留个小名，让朋友找到你呀</h3><p>开通后会得到固定的鲸鲸号。好友申请需要你亲自确认，陌生人不会直接闯进聊天。</p>
   <label>我的聊天小名<input aria-label="我的聊天小名" required maxLength={60} value={name} onChange={event=>setName(event.target.value)} placeholder="朋友会怎样称呼你呢？" autoComplete="nickname"/></label>
   <label className="friend-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>我同意开通好友聊天，将昵称、鲸鲸号和好友关系保存在联机服务。聊天内容保存在设备里，双方在线时才能实时聊天。</span></label>
   <button className="friend-primary" type="submit" disabled={disabled||!consent||!name.trim()}>{busy==='enable'?<LoaderCircle className="friend-spin" size={17}/>:<UserPlus size={17}/>}领我的鲸鲸号</button>
   <small>这个号码属于当前设备。卸载或清除资料会失去身份，暂不支持找回或跨设备同步。</small>
  </form>:<>
   <nav className="friends-tabs" aria-label="好友页面"><button type="button" aria-selected={tab==='friends'} className={tab==='friends'?'selected':''} onClick={()=>setTab('friends')}><Users size={17}/>好友{incoming.length>0&&<b>{incoming.length}</b>}</button><button type="button" aria-selected={tab==='add'} className={tab==='add'?'selected':''} onClick={()=>setTab('add')}><UserPlus size={17}/>加好友</button><button type="button" aria-selected={tab==='mine'} className={tab==='mine'?'selected':''} onClick={()=>setTab('mine')}><QrCode size={17}/>我的二维码</button></nav>
   <div className="friends-content" key={tab}>
    {tab==='mine'&&<div className="friend-own-card"><span className="friend-avatar friend-avatar-large" aria-hidden="true">{shortName(self?.name)}</span><h3>{self?.name}</h3><p>让朋友用哦鲸鲸扫一扫，就能向你打招呼。</p>{qr?<img className="friend-qr" src={qr} alt={'加 '+self?.name+' 为好友的二维码'}/>:<div className="friend-qr friend-qr-loading"><LoaderCircle className="friend-spin"/></div>}<strong className="friend-own-code">{self?.code}</strong><button className="friend-secondary" type="button" disabled={disabled} onClick={()=>copy(self?.code)}><Copy size={16}/>复制我的鲸鲸号</button><small>二维码只包含公开的鲸鲸号，不包含登录凭据。朋友申请后，还要经过你确认哦。</small></div>}
    {tab==='add'&&<div className="friend-add"><form onSubmit={request}><label>输入朋友的鲸鲸号<input aria-label="朋友的鲸鲸号" value={code} onChange={event=>setCode(event.target.value)} maxLength={160} placeholder="JW-XXXX-XXXX-XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false}/></label><p>也可以粘贴朋友发来的好友码，确认后再送出招呼。</p><button type="submit" className="friend-primary" disabled={disabled||!code.trim()}>{busy==='request'?<LoaderCircle size={17} className="friend-spin"/>:<UserPlus size={17}/>}发送好友申请</button></form><div className="friend-scan-actions"><button type="button" className="friend-secondary" onClick={startCamera} disabled={disabled||camera}><Camera size={17}/>扫一扫</button><button type="button" className="friend-secondary" onClick={()=>fileInput.current?.click()} disabled={disabled}><ImageIcon size={17}/>从图片识别</button><input className="friend-file-input" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" aria-label="选择好友二维码图片" onChange={readQrImage}/></div>{camera&&<div className="friend-camera"><video ref={video} autoPlay muted playsInline aria-label="好友二维码扫描预览"/><div className="friend-camera-frame" aria-hidden="true"><ScanLine size={120}/></div><p>把朋友的二维码放进画面呀</p><button type="button" onClick={stopCamera}>停止扫码</button></div>}{cameraError&&<p className="friends-error" role="alert">{cameraError}</p>}<small>识别完成会先展示鲸鲸号，不会自动添加，也不会打开二维码里的网页。</small></div>}
    {tab==='friends'&&<>
     {connected&&<p className="friends-notice" role="status">已经接上聊天啦。如想和另一位朋友聊，请先断开当前连接。</p>}
     {calls.length>0&&<section className="friend-group friend-calls" aria-label="聊天邀请"><h3><PhoneIncoming size={18}/>有人在轻轻敲门</h3>{calls.map(call=><article key={call.id} className="friend-row"><Person person={call.peer}><span>{call.status==='accepted'?'已经接听，准备接上聊天啦':call.direction==='incoming'?'想和你聊聊天':'等对方接听中……'}</span></Person><div className="friend-row-actions">{call.status==='accepted'?<button className="friend-primary" type="button" disabled={disabled||connected} onClick={()=>connectCall(call.id)}><MessageCircle size={16}/>接上聊天</button>:call.direction==='incoming'?<><button type="button" className="friend-secondary" disabled={disabled} onClick={()=>respondCall(call,false)}>先不接</button><button type="button" className="friend-primary" disabled={disabled||connected} onClick={()=>respondCall(call,true)}>接听</button></>:<button type="button" className="friend-secondary" disabled={disabled} onClick={()=>action('end-call:'+call.id,async()=>{intent.current.delete(call.id);await window.ly.friendsEndCall({callId:call.id});await refresh();setNotice('已经收回这次邀请啦。');})}>收回邀请</button>}</div></article>)}</section>}
     {incoming.length>0&&<section className="friend-group" aria-label="新的好友申请"><h3>新的招呼 <span>{incoming.length}</span></h3>{incoming.map(request=><article className="friend-row" key={request.id}><Person person={request.from}/><div className="friend-row-actions"><button type="button" className="friend-secondary" disabled={disabled} onClick={()=>action('decline:'+request.id,async()=>{await window.ly.friendsRespond({requestId:request.id,accept:false});await refresh();setNotice('这次先不加啦。');})}>暂不添加</button><button type="button" className="friend-primary" disabled={disabled} onClick={()=>action('accept:'+request.id,async()=>{await window.ly.friendsRespond({requestId:request.id,accept:true});await refresh();setNotice('成为好友啦，下次直接在列表里找 TA。');})}><Check size={15}/>成为好友</button></div></article>)}</section>}
     <section className="friend-group" aria-label="我的好友"><div className="friend-section-heading"><h3>我的好友 <span>{contacts.length}</span></h3><button className="friend-icon-button" type="button" aria-label="刷新好友列表" disabled={disabled} onClick={()=>action('refresh',async()=>{await refresh();setNotice('好友列表已更新啦。');})}><RefreshCw size={17} className={busy==='refresh'?'friend-spin':''}/></button></div>{contacts.length?contacts.map(friend=><article className="friend-row" key={friend.id}><Person person={friend}><span className={'friend-presence '+(friend.online?'online':'')}><i/>{friend.online?'在线，可以敲敲门':'暂时离线，等 TA 回来呀'}</span></Person><div className="friend-row-actions"><button type="button" className="friend-primary" disabled={disabled||connected||!friend.online||activeCall} onClick={()=>callFriend(friend)}><MessageCircle size={16}/>聊聊天</button><button type="button" className="friend-icon-button friend-block-button" aria-label={'屏蔽 '+friend.name} disabled={disabled} onClick={()=>setBlockTarget(friend)}><X size={15}/></button></div></article>):<div className="friends-empty"><span className="friend-empty-whale" aria-hidden="true">🐋</span><h3>好友位，留给想念的人</h3><p>把你的二维码发给朋友，或输入 TA 的鲸鲸号，下一次就能直接找到彼此。</p><button type="button" className="friend-secondary" onClick={()=>setTab('add')}>加第一位好友<ChevronRight size={16}/></button></div>}</section>
     {outgoing.length>0&&<section className="friend-group" aria-label="等待确认的好友申请"><h3>招呼已送出</h3>{outgoing.map(request=><article key={request.id} className="friend-row"><Person person={request.to}/><span className="friend-waiting">等对方确认呀</span></article>)}</section>}
     <p className="friend-footnote"><ShieldCheck size={15}/>好友关系会保留。收到敲门提醒后，打开好友页接听就好。离线消息暂不代收。</p>
    </>}
   </div>
  </>}
  {blockTarget&&<div className="friend-block-confirm" role="alertdialog" aria-label="确认屏蔽好友"><h3>暂时与 {blockTarget.name} 保持距离？</h3><p>会移出好友列表，并拦住 TA 的新申请。当前版本暂不支持解除屏蔽。</p><div><button type="button" className="friend-secondary" onClick={()=>setBlockTarget(null)} disabled={disabled}>先留着</button><button type="button" className="friend-danger" disabled={disabled} onClick={()=>action('block',async()=>{await window.ly.friendsBlock({friendId:blockTarget.id});await onBlocked?.(blockTarget.id);setBlockTarget(null);await refresh();setNotice('已屏蔽，对方不能再向你发申请。');})}>确认屏蔽</button></div></div>}
  {onAdvanced&&<footer className="friends-advanced"><button type="button" onClick={()=>{stopCamera();onAdvanced();}}><SlidersHorizontal size={14}/>高级联机方式</button></footer>}
 </section>;
}
