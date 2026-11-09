import React,{useState} from 'react';
import {ArrowUpRight,MessageCircle,Users,Settings,ArrowRight,Sparkles,Map,Gamepad2,Home} from 'lucide-react';
import './house.css';

// Match only shipped image paths: a custom avatar keeps its own framing even on a built-in role.
const PORTRAIT_SHEETS=Object.freeze({'assets/qwen.png':'qwen','assets/kimi.png':'kimi','assets/doubao.png':'doubao','assets/chatgpt.png':'chatgpt','assets/claude.png':'claude','assets/gemini.png':'gemini','assets/grok.png':'grok'});
export function HousePortrait({agent,size=''}){const sheet=Object.hasOwn(PORTRAIT_SHEETS,agent?.avatar)?PORTRAIT_SHEETS[agent.avatar]:'';return <span className={`house-portrait ${size}${sheet?` house-portrait-sheet house-portrait-${sheet}`:''}`} style={{'--portrait-hue':`${[...String(agent?.id||'a')].reduce((n,c)=>n+c.charCodeAt(0),0)%60+155}`}}>{agent?.avatar?<img src={agent.avatar} alt=""/>:<span>{(agent?.name||'鲸').slice(0,1)}</span>}</span>}
const places=[{id:'dorm',Icon:Home,label:'回宿舍',subtitle:'三位伙伴，留一盏灯',color:'peach'},{id:'travel',Icon:Map,label:'一起旅行',subtitle:'从月湾小镇出发',color:'sage'},{id:'game',Icon:Gamepad2,label:'玩一小局',subtitle:'猜数字 · 石头剪刀布',color:'butter'}];

export default function HouseHome({state={},onChat=()=>{},onRoom=()=>{},onOpenChats=()=>{},onOpenGroups=()=>{},onOpenSettings=()=>{}}){
 const agents=state.agents||[],name=state.settings?.displayName;
 return <main className="house-home" data-testid="house-home">
  <div className="house-sunwash" aria-hidden="true"/>
  <header className="house-top"><a className="house-wordmark" href="#" onClick={e=>e.preventDefault()} aria-label="哦鲸鲸小屋"><span>ohwhale</span><small>有你在的地方</small></a><button className="house-settings" onClick={onOpenSettings} aria-label="小屋设置"><Settings size={20}/><span>小屋设置</span></button></header>
  <section className="house-living">
   <div className="house-greeting"><span className="house-eyebrow"><i/> YOUR LITTLE HOME</span><h1>{name&&name!=='我'?`${name}，回来啦。`:'回来啦。'}<br/><em>今天，想和谁待一会儿？</em></h1><p>放下今天的忙碌。<br/>聊一点小事，或和大家一起出发。</p><div className="house-main-actions"><button onClick={onOpenChats} data-testid="house-private"><MessageCircle size={20}/><span>单独聊聊<small>只属于你们的对话</small></span><ArrowUpRight size={19}/></button><button onClick={()=>onRoom('dorm')} data-testid="house-group"><Users size={20}/><span>大家一起<small>你 + 三位 AI 伙伴</small></span><ArrowUpRight size={19}/></button></div></div>
   <div className="house-illustration" role="group" aria-label="小屋里的生活角落">
    <div className="house-window" aria-hidden="true"><div className="house-outside"><i/><b/></div><span/><span/></div><div className="house-curtain" aria-hidden="true"/>
    <div className="house-wall-note"><Sparkles size={16}/><span>今天也可以<br/>慢慢来。</span></div>
    <div className="house-lamp" aria-hidden="true"><i/><span/></div><div className="house-floor" aria-hidden="true"/><div className="house-rug" aria-hidden="true"/>
    <button className="house-sofa" onClick={()=>onRoom('dorm')} aria-label="坐进宿舍，和三位 AI 聊聊"><span className="house-sofa-back"/><i/><i/><b/><span className="house-sofa-label"><Users size={16}/>坐下来，一起聊</span></button>
    <button className="house-suitcase" onClick={()=>onRoom('travel')} aria-label="一起去旅行"><span/><Map size={23}/></button>
    <button className="house-game" onClick={()=>onRoom('game')} aria-label="玩一小局"><Gamepad2 size={28}/></button>
    <div className="house-plant" aria-hidden="true"><i/><i/><i/><i/><b/></div>
    <span className="house-scene-caption">一间小屋，几种一起度过的方式</span>
   </div>
  </section>
  <section className="house-companions"><div className="house-section-heading"><div><span className="house-eyebrow">PICK A COMPANION</span><h2>想说的话，留给她听。</h2></div><button onClick={onOpenChats}>全部聊天 <ArrowRight size={17}/></button></div><div className="house-companion-list">{agents.slice(0,6).map((agent,i)=><button className="house-companion" key={agent.id} onClick={()=>onChat(agent)} data-testid={`house-chat-${agent.id}`}><span className="house-companion-orbit"><HousePortrait agent={agent}/><i>{['☁','✦','❀','☾','♡','✧'][i]}</i></span><strong>{agent.name}</strong><small>{agent.subtitle||'有空，来聊聊呀'}</small><span className="house-private-tag">单聊 <ArrowUpRight size={13}/></span></button>)}{!agents.length&&<button className="house-no-companion" onClick={onOpenSettings}><Sparkles size={28}/><strong>给第一位伙伴留个位置</strong><span>到角色设置里接她回家</span></button>}</div></section>
  <section className="house-outings"><div className="house-section-heading"><div><span className="house-eyebrow">TOGETHER, AT YOUR PACE</span><h2>一个人，也能热热闹闹。</h2></div><span className="house-local-note">无需加好友，直接入住</span></div><div className="house-places">{places.map(({id,Icon,label,subtitle,color},i)=><button key={id} className={`house-place ${color}`} onClick={()=>onRoom(id)} data-testid={`house-room-${id}`}><span className="house-place-number">0{i+1}</span><Icon size={28} strokeWidth={1.4}/><span><strong>{label}</strong><small>{subtitle}</small></span><ArrowUpRight size={19}/></button>)}</div></section>
  <footer className="house-footer"><HouseTerms/><button onClick={onOpenGroups}><Users size={15}/>和真人朋友群聊 <ArrowUpRight size={14}/></button></footer>
 </main>
}

export function HouseTerms(){const[error,setError]=useState('');return <span className="house-terms">使用即表示接受<a href="https://47.86.23.218/terms" onClick={async e=>{e.preventDefault();setError('');try{if(!window.ly?.openExternal)throw Error('协议暂时没有打开，请更新应用后重试。');await window.ly.openExternal({url:'https://47.86.23.218/terms'})}catch(e){setError(e?.message||'协议暂时没有打开，请再试一次。')}}}>用户协议</a>{error&&<small className="house-terms-error" role="alert">{error}</small>}</span>}
