'use strict';
try{require('./runtime.cjs').installMobileBridge();}catch(error){globalThis.__ohwhaleBootError=error.message;document.addEventListener('DOMContentLoaded',()=>{const root=document.getElementById('root');if(root){root.textContent='本机资料暂时没有打开：'+error.message+'。请保留应用数据后重试，不要清除资料。';root.style.cssText='padding:30px;font:16px sans-serif;line-height:1.8;';}});throw error;}
