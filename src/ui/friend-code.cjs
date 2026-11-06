'use strict';
const FRIEND_QR_PREFIX='ohwhale:friend:v1:';
const CODE_RE=/^JW-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
function normalizeFriendCode(value){
 if(typeof value!=='string'||value.length>160||/[\x00-\x08\x0e-\x1f\x7f]/.test(value))throw Error('鲸鲸号没有读完整，再核对一下呀。');
 let raw=value.trim();
 if(raw.startsWith(FRIEND_QR_PREFIX))raw=raw.slice(FRIEND_QR_PREFIX.length);
 else if(raw.includes(':')||raw.includes('/')||raw.includes('?')||raw.includes('#'))throw Error('这不是哦鲸鲸的好友码，请让朋友打开“我的二维码”。');
 const compact=raw.toUpperCase().replace(/[ -]/g,'');
 if(!/^JW[A-HJ-NP-Z2-9]{12}$/.test(compact))throw Error('请输入 JW 开头的鲸鲸号，字母和数字一共 14 位。');
 return 'JW-'+compact.slice(2,6)+'-'+compact.slice(6,10)+'-'+compact.slice(10,14);
}
function friendQRPayload(code){const normalized=normalizeFriendCode(code);if(!CODE_RE.test(normalized))throw Error('鲸鲸号格式不对呀。');return FRIEND_QR_PREFIX+normalized;}
function parseFriendQR(value){
 if(typeof value!=='string'||!value.startsWith(FRIEND_QR_PREFIX))throw Error('这张图不是好友二维码，请让朋友打开“我的二维码”再试试。');
 const code=value.slice(FRIEND_QR_PREFIX.length);
 if(!CODE_RE.test(code))throw Error('二维码里的鲸鲸号没有读完整，再试一次呀。');
 return code;
}
module.exports={FRIEND_QR_PREFIX,normalizeFriendCode,friendQRPayload,parseFriendQR};
