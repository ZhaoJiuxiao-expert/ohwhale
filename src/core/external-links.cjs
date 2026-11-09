'use strict';
const TERMS_URL='https://47.86.23.218/terms';
function externalLink(input){if(!input||input.url!==TERMS_URL)throw Error('这份链接暂未开放，请从小屋里的用户协议进入。');return TERMS_URL;}
module.exports={TERMS_URL,externalLink};
