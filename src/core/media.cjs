const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function validateWav(wav,{recording=false}={}){
 if(!Buffer.isBuffer(wav)||wav.length<44||wav.length>12e6||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('语音文件不是有效的WAV录音');
 if(wav.readUInt32LE(4)!==wav.length-8)throw Error('语音文件RIFF长度不符');
 let fmt,data,total=0,off=12;for(;off+8<=wav.length;){const kind=wav.toString('ascii',off,off+4),size=wav.readUInt32LE(off+4),end=off+8+size+(size%2);if(end>wav.length)throw Error('语音文件不完整');if(kind==='fmt '){if(size<16||fmt)throw Error('语音格式不完整或重复');fmt={format:wav.readUInt16LE(off+8),channels:wav.readUInt16LE(off+10),rate:wav.readUInt32LE(off+12),bytes:wav.readUInt32LE(off+16),align:wav.readUInt16LE(off+20),bits:wav.readUInt16LE(off+22)};}if(kind==='data'){if(data||!fmt)throw Error('语音数据块顺序或数量无效');data=true;total+=size;}off=end;}
 if(off!==wav.length||!fmt||!data||!total||fmt.format!==1||![1,2].includes(fmt.channels)||![8,16].includes(fmt.bits)||fmt.rate<8000||fmt.rate>48000||fmt.align!==fmt.channels*fmt.bits/8||fmt.bytes!==fmt.rate*fmt.align||total%fmt.align)throw Error('仅支持标准PCM WAV语音');
 if(recording&&(fmt.channels!==1||fmt.rate!==16000||fmt.bits!==16||total/fmt.bytes>60))throw Error('录音须为60秒内16kHz单声道PCM');
 if(total/fmt.bytes>300)throw Error('单条语音最长5分钟');return {duration:total/fmt.bytes,...fmt};
}
class MediaStore{
 constructor({dir,nativeImage}){this.dir=path.join(dir,'media');this.nativeImage=nativeImage;fs.mkdirSync(this.dir,{recursive:true});}
 put({buffer,type,name='附件'}){
  if(!Buffer.isBuffer(buffer)||buffer.length>10*1024*1024||!buffer.length)throw Error('附件大小须在10MB以内');
  let mime,ext,duration;
  if(type==='image'){
   // Decode and re-encode images to remove metadata and reject executable/vector content.
   const img=this.nativeImage.createFromBuffer(buffer);if(img.isEmpty())throw Error('无法读取这张图片，请选择PNG或JPEG图片');
   const size=img.getSize();if(size.width*size.height>40e6)throw Error('图片分辨率过大，请先缩小');
   const scale=Math.min(1,2048/Math.max(size.width,size.height));
   buffer=(scale<1?img.resize({width:Math.round(size.width*scale),height:Math.round(size.height*scale)}):img).toPNG();mime='image/png';ext='png';
  }else if(type==='audio'){const info=validateWav(buffer);duration=info.duration;mime='audio/wav';ext='wav';}else throw Error('不支持的附件类型');
  const id=crypto.randomUUID();const meta={id,type,mime,name:String(name).replace(/[\x00-\x1f]/g,'').slice(0,100)||'附件',bytes:buffer.length,url:`lingyu-media://asset/${id}`,...(duration?{duration}:{}),ext};
  fs.writeFileSync(path.join(this.dir,`${id}.${ext}`),buffer,{flag:'wx'});fs.writeFileSync(path.join(this.dir,`${id}.json`),JSON.stringify(meta),{flag:'wx'});return this.public(meta);
 }
 public(meta){const {ext,...data}=meta;return data;}
 get(id){if(!ID.test(id||''))throw Error('附件标识无效');const meta=JSON.parse(fs.readFileSync(path.join(this.dir,`${id}.json`),'utf8'));if(!['png','wav'].includes(meta.ext)||meta.id!==id)throw Error('附件数据无效');return {meta,buffer:fs.readFileSync(path.join(this.dir,`${id}.${meta.ext}`))};}
 resolve(id){const {meta,buffer}=this.get(id);return {dataUrl:`data:${meta.mime};base64,${buffer.toString('base64')}`,name:meta.name,type:meta.type};}
 fromData({dataUrl,name,type}){if(typeof dataUrl!=='string'||dataUrl.length>14e6)throw Error('附件过大或格式无效');const m=/^data:(image\/(?:png|jpeg|webp|gif)|audio\/wav);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);if(!m||!m[1].startsWith(type+'/'))throw Error('附件格式不支持');const buffer=Buffer.from(m[2],'base64');if(buffer.toString('base64')!==m[2])throw Error('附件编码无效');return this.put({buffer,type,name});}
 validated(attachments=[]){if(!Array.isArray(attachments)||attachments.length>4)throw Error('每条消息最多4个附件');return attachments.map(a=>this.public(this.get(a?.id).meta));}
}
module.exports={MediaStore,validateWav};
