'use strict';
const {validateAgent}=require('./store.cjs');
const MAX_CARD_BYTES=16*1024*1024;
const FIELDS=['name','subtitle','avatar','accent','persona','voice','tags'];
function plain(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
function validateCharacter(character){
 if(!plain(character))throw Error('这张角色卡还没有完整的人设内容呀。');
 // Validate with the same rules as a saved role, before writing any imported media.
 return validateAgent({id:'import-preview',...Object.fromEntries(FIELDS.filter(k=>Object.prototype.hasOwnProperty.call(character,k)).map(k=>[k,character[k]])),providerId:'',memory:'',greeting:{enabled:false,hour:10}});
}
function exportRoleCard({store,media,agentId}){
 const card=store.exportAgent(agentId),character=Object.fromEntries(FIELDS.filter(k=>k in card).map(k=>[k,card[k]]));
 const result={format:'ohwhale-character',version:2,character};
 if(character.avatar?.startsWith('lingyu-media://asset/')){const asset=media.resolve(character.avatar.slice('lingyu-media://asset/'.length));if(asset.type!=='image')throw Error('角色头像需要是一张图片呀。');result.avatar={dataUrl:asset.dataUrl,name:'角色头像.png'};character.avatar='';}
 return result;
}
function importRoleCard({store,media,input}){
 if(!plain(input)||JSON.stringify(input).length>MAX_CARD_BYTES)throw Error('角色卡太大或格式不完整，请重新选择呀。');
 const portable=input.format==='ohwhale-character';if(portable&&input.version!==2)throw Error('这张角色卡来自更新的版本，请先更新哦鲸鲸。');
 if(!portable&&input.format!==undefined&&input.format!=='lingyu-agent')throw Error('这张卡片暂时还认不出来，请选择哦鲸鲸角色卡。');
 const source=portable?input.character:input;let card=validateCharacter(source);const warnings=[];
 if(!portable&&input.version!==undefined&&input.version!==1)throw Error('角色卡版本暂不支持');
 const known=portable?['format','version','character','avatar']:['format','version','id',...FIELDS];
 const ignored=Object.keys(input).filter(k=>!known.includes(k));
 if(ignored.length)warnings.push('卡片里还有未识别字段，原文件已保留，暂未启用：'+ignored.slice(0,8).join('、'));
 if(portable){const unknown=Object.keys(source).filter(k=>!FIELDS.includes(k));if(unknown.length)warnings.push('有未识别的人设字段，原文件已保留：'+unknown.slice(0,8).join('、'));}
 if(portable&&input.avatar!==undefined){if(!plain(input.avatar)||typeof input.avatar.dataUrl!=='string'||!/^data:image\/(png|jpeg|webp|gif);base64,/.test(input.avatar.dataUrl))throw Error('角色头像没读完整，请重新导出卡片呀。');const asset=media.fromData({type:'image',name:'角色头像.png',dataUrl:input.avatar.dataUrl});card.avatar=asset.url;}
 else if(card.avatar?.startsWith('lingyu-media://asset/')){card.avatar='';warnings.push('旧版卡片没有带上头像，先用名字头像陪你聊；可让朋友用新版重新导出。');}
 const agent=store.importAgent({format:'lingyu-agent',version:1,...card});
 return {...agent,importWarnings:warnings};
}
module.exports={exportRoleCard,importRoleCard,MAX_CARD_BYTES};
