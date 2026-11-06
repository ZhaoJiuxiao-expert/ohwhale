const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
function runSpeech(mode,input={},options={}){
 return new Promise((resolve,reject)=>{
  const signal=options.signal;
  const cancelled=()=>Object.assign(Error('这句先不念啦，想听时再点一下就好。'),{code:'CANCELLED'});
  if(signal?.aborted){reject(cancelled());return;}
  const script=path.join(__dirname,'../speech.ps1');const unpacked=script.replace('app.asar','app.asar.unpacked');
  const ps=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fs.existsSync(unpacked)?unpacked:script,'-Mode',mode],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',settled=false,timer;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);error?reject(error):resolve(value);};
  const stop=()=>{ps.kill();finish(cancelled());};signal?.addEventListener('abort',stop,{once:true});
  timer=setTimeout(()=>{ps.kill();finish(Error('声音准备得有点久啦，请试一小段文字再听听。'));},75000);
  ps.stdout.setEncoding('utf8');ps.stdout.on('data',s=>{out+=s;if(out.length>20e6){ps.kill();finish(Error('语音内容过长'));}});ps.stderr.on('data',()=>{});
  ps.on('error',()=>finish(Error('小鲸暂时找不到Windows语音组件，请检查系统语音设置。')));ps.on('close',code=>{try{const data=JSON.parse(out.replace(/^\uFEFF/,''));if(code||data.error)throw Error('中文语音组件还没准备好，请检查Windows语音包和所选声音。');finish(null,data);}catch(e){finish(Error(e.message.includes('语音')?e.message:'声音没能准备好，请稍后再试呀。'));}});
  ps.stdin.on('error',()=>{});ps.stdin.end(JSON.stringify(input));
 });
}
module.exports={runSpeech};
