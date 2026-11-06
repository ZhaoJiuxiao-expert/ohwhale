function localDay(now){return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
function dueGreetings(state,now=new Date()){
 const hour=now.getHours(),quiet=state.settings?.quietHours||{enabled:true,start:22,end:8};
 if(quiet.enabled){const start=quiet.start,end=quiet.end;if(start===end||(start<end?hour>=start&&hour<end:hour>=start||hour<end))return [];}
 const day=localDay(now);
 return state.agents.filter(a=>a.greeting?.enabled&&Number.isInteger(a.greeting.hour)&&hour>=a.greeting.hour&&state.greetings?.[a.id]!==day).filter(a=>{const p=state.providers.find(p=>p.id===a.providerId);return p?.consent&&(p.hasKey||/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(p.baseUrl));});
}
module.exports={dueGreetings,localDay};
