import React from 'react';
import {Users,ArrowUpRight,Home,Map,Gamepad2,MessageCircle,UserPlus,ChevronRight} from 'lucide-react';

const ROOMS=[
 {id:'dorm',name:'四人宿舍',note:'你 + 三位 AI 伙伴',text:'放下书包，聊聊今天的小事。',Icon:Home,testId:'hub-ai-dorm'},
 {id:'travel',name:'一起去旅行',note:'边走边聊',text:'下一站去哪儿？和伙伴们一起决定。',Icon:Map,testId:'hub-ai-travel'},
 {id:'game',name:'游戏之夜',note:'猜数字 · 石头剪刀布',text:'开一小局，看看今天谁的手气好。',Icon:Gamepad2,testId:'hub-games'}
];

export default function GroupHub({onRoom,onHuman,onFriends}){
 return <section className="group-hub" data-testid="group-hub">
  <header className="hub-heading"><div><span>OHWHALE · TOGETHER</span><h1>群聊</h1><p>把喜欢的人聚在一起，把话题慢慢聊开。</p></div><Users size={36} strokeWidth={1.4}/></header>
  <section className="hub-human"><div className="hub-human-icon"><Users size={30}/></div><div><h2>和朋友一起聊</h2><p>创建群聊，分享邀请码；朋友进来后，也能邀请 AI 一起加入。</p><div className="hub-human-actions"><button className="hub-primary" onClick={onHuman} data-testid="hub-human-groups">打开真人群聊 <ArrowUpRight size={17}/></button><button className="hub-secondary" onClick={onFriends} data-testid="hub-add-friend"><UserPlus size={17}/>添加好友 / 我的二维码</button></div></div></section>
  <div className="hub-section-heading"><div><h2>和 AI 伙伴一起玩</h2><p>一个人就能开始，不用先添加好友。</p></div><button onClick={()=>onRoom('')} data-testid="hub-all-rooms">我的房间 <ChevronRight size={16}/></button></div>
  <div className="hub-rooms">{ROOMS.map(({id,name,note,text,Icon,testId})=><button key={id} className="hub-room" onClick={()=>onRoom(id)} data-testid={testId}><span className="hub-room-icon"><Icon size={26} strokeWidth={1.6}/></span><small>{note}</small><h3>{name}</h3><p>{text}</p><span className="hub-room-enter">进去坐坐 <ArrowUpRight size={17}/></span></button>)}</div>
  <footer className="hub-foot"><MessageCircle size={16}/><span>小游戏和 3D 小屋都在房间里，想玩的时候再打开。</span></footer>
 </section>
}
