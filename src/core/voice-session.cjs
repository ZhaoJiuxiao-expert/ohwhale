'use strict';
function speechText(text){
 const fence=String.fromCharCode(96).repeat(3);
 return String(text).replace(new RegExp(fence+'[\\s\\S]*?'+fence,'g'),'这部分是代码，可以在聊天里查看。')
  .replace(/\[sticker:[A-Za-z0-9_-]+\]/g,'').replace(/!\[([^\]]*)\]\([^)]+\)/g,'$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/https?:\/\/[^\s<]+/g,'（链接）')
  .replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/^\s*>\s?/gm,'')
  .replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1')
  .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').replace(/[ \t]+/g,' ').trim();
}
class VoiceSession{
 constructor(){this.active=null;}
 run(key,task){
  if(this.active?.key===key)return this.active.promise;
  this.stop();const controller=new AbortController(),record={key,controller,promise:null};this.active=record;
  record.promise=Promise.resolve().then(()=>task(controller.signal)).finally(()=>{if(this.active===record)this.active=null;});return record.promise;
 }
 stop(prefix){const current=this.active;if(!current||prefix&&!current.key.startsWith(prefix))return false;current.controller.abort();this.active=null;return true;}
}
module.exports={speechText,VoiceSession};
