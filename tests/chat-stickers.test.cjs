'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {StudioService}=require('../src/core/studio-service.cjs');
const {ChatStore}=require('../src/core/store.cjs');

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-stickers-'));
 const store=new ChatStore({dir:path.join(dir,'chat'),encrypt:v=>v,decrypt:v=>v});
 const images=new Map();let changes=0;
 const media={get(id){const image=images.get(id);if(!image)throw Error('本机附件不存在');return image;},validated(items){return items.map(a=>({...this.get(a.id).meta}));}};
 const options={dir,store,media,onChange:()=>changes++};
 const service=new StudioService(options),conversation=store.createConversation({type:'ai',agentId:'deepseek'});
 const add=(bytes='png-fixture',type='image')=>{
  const id=crypto.randomUUID(),buffer=Buffer.from(bytes),attachment={id,type,mime:type==='image'?'image/png':'audio/wav',name:type==='image'?'小鲸.png':'录音.wav',bytes:buffer.length,url:'lingyu-media://asset/'+id};
  images.set(id,{meta:attachment,buffer});
  const message=store.addMessage(conversation.id,{role:'user',text:'',attachments:[attachment]});
  return {attachment,message,input:{conversationId:conversation.id,messageId:message.id,attachmentId:id}};
 };
 return {dir,store,media,service,conversation,options,images,add,changes:()=>changes};
}

test('message stickers persist, keep source messages, and deduplicate image bytes across media IDs',()=>{
 const x=fixture(),first=x.add(),sameImage=x.add(),before=x.store.getPublic();
 const saved=x.service.saveMessageSticker(first.input);
 assert.equal(saved.duplicate,false);assert.match(saved.sticker.id,/^saved-[a-f0-9]{64}$/);
 assert.equal(saved.sticker.character,'自定义');assert.deepEqual(saved.sticker.attachment,first.attachment);
 assert.equal(saved.sticker.src,first.attachment.url);assert.equal(x.changes(),1);
 const duplicate=x.service.saveMessageSticker(sameImage.input);
 assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.sticker,saved.sticker);assert.equal(x.changes(),1);
 assert.deepEqual(x.store.getPublic(),before);assert.equal(x.images.size,2);
 const restarted=new StudioService(x.options);
 assert.deepEqual(restarted.customStickers(),[saved.sticker]);
 assert.equal(restarted.saveMessageSticker(first.input).duplicate,true);
 const third=x.add('different-png-fixture');assert.equal(restarted.saveMessageSticker(third.input).duplicate,false);
 assert.equal(restarted.customStickers().length,2);
 saved.sticker.attachment.name='renderer mutation';assert.equal(restarted.customStickers()[0].attachment.name,'小鲸.png');
});

test('message sticker collection rejects non-owned images, malformed IDs, URL/path injection and audio',()=>{
 const x=fixture(),image=x.add(),audio=x.add('wav-fixture','audio');
 const other=x.store.createConversation({type:'peer',name:'朋友'});
 const alien=crypto.randomUUID();
 for(const input of [undefined,null,[],{}, {...image.input,url:'https://example.com/photo.png'}, {...image.input,path:'C:/private/photo.png'}, {...image.input,attachmentId:'../photo'}, {...image.input,messageId:'__proto__'}, {...image.input,conversationId:other.id}, {...image.input,messageId:alien}, {...image.input,attachmentId:alien},audio.input])assert.throws(()=>x.service.saveMessageSticker(input));
 assert.equal(x.service.customStickers().length,0);assert.equal(x.changes(),0);
 const record=x.images.get(image.attachment.id);record.meta.type='audio';record.meta.mime='audio/wav';
 assert.throws(()=>x.service.saveMessageSticker(image.input));
 assert.equal(fs.readdirSync(x.service.dir).length,0);
});

test('missing or truncated source image does not create a sticker',()=>{
 const x=fixture(),image=x.add(),record=x.images.get(image.attachment.id);
 x.images.delete(image.attachment.id);assert.throws(()=>x.service.saveMessageSticker(image.input),/不存在/);
 x.images.set(image.attachment.id,{...record,buffer:Buffer.from('truncated')});assert.throws(()=>x.service.saveMessageSticker(image.input),/不完整/);
 assert.equal(x.service.customStickers().length,0);assert.equal(x.changes(),0);
});

test('a failed event write leaves library and original messages untouched and can be retried',()=>{
 const x=fixture(),image=x.add(),before=x.store.getPublic(),write=fs.writeFileSync;
 fs.writeFileSync=function(file,...args){if(typeof file==='number')throw Error('DISK_FULL_FIXTURE');return write.call(this,file,...args);};
 try{assert.throws(()=>x.service.saveMessageSticker(image.input),/DISK_FULL_FIXTURE/);}finally{fs.writeFileSync=write;}
 assert.deepEqual(x.service.customStickers(),[]);assert.equal(x.changes(),0);
 assert.deepEqual(x.store.getPublic(),before);assert.deepEqual(new StudioService(x.options).customStickers(),[]);
 assert.equal(x.service.saveMessageSticker(image.input).duplicate,false);
 assert.equal(new StudioService(x.options).customStickers().length,1);
});

test('saved images coexist with existing studio stickers and export local attachments for resending',()=>{
 const x=fixture(),image=x.add();
 x.service.record({kind:'publish',projectId:'project',entry:{id:'fixture',type:'sticker',displayNames:{zhCN:'工作台小鲸'},code:JSON.stringify({tags:['小鲸']}),texture:image.attachment}});
 x.service.saveMessageSticker(image.input);
 const library=new StudioService(x.options).customStickers();
 assert.equal(library.length,2);assert.equal(library[0].id,'custom-fixture');
 for(const sticker of library)assert.deepEqual(x.media.validated([sticker.attachment]),[image.attachment]);
});
