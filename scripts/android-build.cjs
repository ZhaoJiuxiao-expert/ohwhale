'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const sdk=process.env.OHWHALE_ANDROID_SDK||path.join(os.homedir(),'.cache/ohwhale-android-sdk');
const debug=process.argv.includes('--debug');
const candidate=process.argv.includes('--candidate');
const appVersion=require('../src/mobile/version.json');
const versionCode=candidate?10201:appVersion.versionCode;
const uiArg=process.argv.indexOf('--ui-src');
const uiSource=uiArg>=0?path.resolve(process.argv[uiArg+1]):path.join(root,'src/ui');
const stamp=Date.now()+'-'+(debug?'debug':'release');
const build=path.join(os.homedir(),'.cache/ohwhale-android-builds',stamp),assets=path.join(build,'assets'),www=path.join(assets,'www'),reference=path.join(assets,'reference');
const generated=path.join(build,'generated'),classes=path.join(build,'classes'),dex=path.join(build,'dex'),tools=path.join(sdk,'build-tools/35.0.0'),androidJar=path.join(sdk,'platforms/android-35/android.jar');
const javaInfo=cp.spawnSync('java',['-XshowSettings:properties','-version'],{encoding:'utf8'});const javaHome=(javaInfo.stderr.match(/java.home = ([^\r\n]+)/)||[])[1]?.trim();
function run(exe,args,options={}){if(javaHome&&['java','javac','jar','keytool'].includes(exe))exe=path.join(javaHome,'bin',exe+'.exe');const result=cp.spawnSync(exe,args,{cwd:root,encoding:'utf8',maxBuffer:12*1024*1024,...options});if(result.error||result.status!==0)throw Error([exe,result.error?.message,result.stdout,result.stderr].filter(Boolean).join('\n'));if(result.stdout?.trim())process.stdout.write(result.stdout);if(result.stderr?.trim())process.stderr.write(result.stderr);return result;}
function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
function copyTree(from,to){if(!fs.existsSync(from))return;for(const entry of fs.readdirSync(from,{withFileTypes:true})){const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory())copyTree(a,b);else if(entry.isFile())copy(a,b);}}
const mobileAlias={'node:fs':path.join(root,'src/mobile/fs.cjs'),'node:path':path.join(root,'src/mobile/path.cjs'),'node:crypto':path.join(root,'src/mobile/crypto.cjs'),'node:zlib':path.join(root,'src/mobile/zlib.cjs')};
async function main(){
 if(!process.env.OHWHALE_SIGNING_PASSWORD)throw Error('请设置本地环境变量 OHWHALE_SIGNING_PASSWORD 以使用自己的签名密钥。');
 if(!fs.existsSync(androidJar))throw Error('Android SDK尚未完整安装；请先运行python scripts/android-setup.py。');
 for(const dir of [www,reference,generated,classes,dex])fs.mkdirSync(dir,{recursive:true});
 await esbuild.build({entryPoints:[path.join(root,'src/mobile/entry.cjs')],bundle:true,platform:'browser',format:'iife',target:'chrome100',outfile:path.join(www,'android-bridge.js'),alias:mobileAlias,define:{__dirname:'"/embedded/src/core"'},minify:!debug,logLevel:'info'});
 await esbuild.build({entryPoints:[path.join(uiSource,'entry.jsx')],bundle:true,platform:'browser',format:'iife',target:'chrome100',outfile:path.join(www,'bundle.js'),define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff':'file','.woff2':'file','.ttf':'file'},minify:!debug,logLevel:'info'});
 copy(path.join(www,'bundle.css'),path.join(www,'build.css'));copyTree(path.join(uiSource,'assets'),path.join(www,'assets'));
 // License text travels with the bundled code, including Three.js and addons.
 copyTree(path.join(root,'licenses'),path.join(assets,'licenses'));
 copy(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(assets,'THIRD_PARTY_NOTICES.md'));
 copy(path.join(root,'docs/house-1.6.md'),path.join(assets,'docs/house-1.6.md'));
 copy(path.join(root,'docs/release-1.6-verification.md'),path.join(assets,'docs/release-1.6-verification.md'));
 copy(path.join(root,'docs/chat-layout-1.7.md'),path.join(assets,'docs/chat-layout-1.7.md'));
 copy(path.join(root,'docs/release-1.7-verification.md'),path.join(assets,'docs/release-1.7-verification.md'));
 let html=fs.readFileSync(path.join(uiSource,'index.html'),'utf8');html=html.replace(/content="default-src[^"\n]*"/,'content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob: lingyu-media:; media-src \'self\' data: blob: lingyu-media:; connect-src \'self\' https: http://127.0.0.1:* http://localhost:* lingyu-media:; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"');html=html.replace('<script src="./bundle.js">','<script src="./android-bridge.js"></script><script src="./bundle.js">');fs.writeFileSync(path.join(www,'index.html'),html,'utf8');
 const references=new Set(['src/core/store.cjs','src/core/harness.cjs','src/core/plugins.cjs','src/core/studio.cjs','src/core/knowledge.cjs','src/core/studio-service.cjs','src/core/role-card.cjs','android/src/cn/ohwhale/chat/MainActivity.java']);
 for(const file of references)copy(path.join(root,file),path.join(reference,file));
 copy(path.join(uiSource,'assets/deepseek-avatar.png'),path.join(root,'android/res/drawable/app_icon.png'));
 const manifest=fs.readFileSync(path.join(root,'android/AndroidManifest.xml'),'utf8').replace('android:debuggable="false"','android:debuggable="'+String(debug)+'"').replace(/android:versionCode="\d+"/,'android:versionCode="'+versionCode+'"').replace(/android:versionName="[^"]+"/,'android:versionName="'+appVersion.version+'"');fs.writeFileSync(path.join(build,'AndroidManifest.xml'),manifest);
 const config=path.join(generated,'cn/ohwhale/chat/BuildConfig.java');fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'package cn.ohwhale.chat; public final class BuildConfig { public static final boolean DEBUG = '+String(debug)+'; }\n');
 copyTree(path.join(root,'android/res'),path.join(build,'res'));const aapt=path.join(tools,'aapt2.exe');run(aapt,['compile','--dir',path.join(build,'res'),'-o',path.join(build,'compiled-res.zip')]);const unsigned=path.join(build,'unsigned.apk'),rawArchive=path.join(build,'aapt-raw.apk');run(aapt,['link','-o',rawArchive,'-I',androidJar,'--manifest',path.join(build,'AndroidManifest.xml'),'--java',generated,'-R',path.join(build,'compiled-res.zip'),'--auto-add-overlay','-0','arsc','-A',assets]);
 run('python',[path.join(root,'scripts/android-normalize-zip.py'),rawArchive,unsigned,'--output',path.join(build,'zip-normalization.json')]);
 const audit=(file,stage,aligned=false)=>run('python',[path.join(root,'scripts/android-audit.py'),file,...(stage==='aapt'?[]:['--require-dex']),...(aligned?['--require-alignment']:[]),'--output',path.join(build,'audit-'+stage+'.json')]);
 audit(unsigned,'aapt');
 function javaFiles(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?javaFiles(path.join(dir,e.name)):e.name.endsWith('.java')?[path.join(dir,e.name)]:[]);}
 run('javac',['-encoding','UTF-8','--release','8','-classpath',androidJar,'-d',classes,...javaFiles(path.join(root,'android/src')),...javaFiles(generated)]);
 const classJar=path.join(build,'classes.jar');run('jar',['--create','--file',classJar,'-C',classes,'.']);run('java',['-cp',path.join(tools,'lib/d8.jar'),'com.android.tools.r8.D8','--lib',androidJar,'--min-api','26','--output',dex,classJar]);
 run(path.join(tools,'aapt.exe'),['add','-f',unsigned,...fs.readdirSync(dex).filter(n=>n.endsWith('.dex'))],{cwd:dex});audit(unsigned,'dex');
 const aligned=path.join(build,'aligned.apk');run(path.join(tools,'zipalign.exe'),['-P','16','-f','4',unsigned,aligned]);audit(aligned,'aligned',true);
 const keyDir=process.env.OHWHALE_ANDROID_SIGNING_DIR||path.join(os.homedir(),'Documents/ai聊天软件/developer/android-signing'),keystore=path.join(keyDir,'ohwhale-local.jks');
 const oldKey=path.join(os.homedir(),'.cache/ohwhale-android-signing/ohwhale-development.jks');
 if(!fs.existsSync(keystore)&&process.argv.includes('--initialize-signing')){fs.mkdirSync(keyDir,{recursive:true});if(fs.existsSync(oldKey)){fs.copyFileSync(oldKey,keystore,fs.constants.COPYFILE_EXCL);}else{if(fs.existsSync(path.join(root,'android/output/build.json'))||fs.existsSync(path.join(root,'android/output/debug-build.json')))throw Error('已有构建身份但原签名钥匙缺失，不能生成新身份。请恢复原钥匙。');run('keytool',['-genkeypair','-keystore',keystore,'-storepass:env','OHWHALE_SIGNING_PASSWORD','-keypass:env','OHWHALE_SIGNING_PASSWORD','-alias','ohwhale-development','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=OhWhale Local Build,O=Private Development,C=CN']);}}
 if(!fs.existsSync(keystore))throw Error('固定签名钥匙尚未初始化或已丢失。首次新项目请显式 --initialize-signing；已有安装请恢复原钥匙，不能静默更换签名。');
 const apk=path.join(build,'ohwhale-'+appVersion.version+(candidate?'-install-candidate':debug?'-debug':'')+'.apk'),signer=path.join(tools,'lib/apksigner.jar');run('java',['-jar',signer,'sign','--ks',keystore,'--ks-key-alias','ohwhale-development','--ks-pass','env:OHWHALE_SIGNING_PASSWORD','--key-pass','env:OHWHALE_SIGNING_PASSWORD','--v1-signing-enabled','true','--v2-signing-enabled','true','--v3-signing-enabled','true','--out',apk,aligned]);const verification=run('java',['-jar',signer,'verify','--verbose','--print-certs','--min-sdk-version','26',apk]).stdout;
 const legacyVerification=run('java',['-jar',signer,'verify','--verbose','--print-certs','--min-sdk-version','23','--max-sdk-version','23',apk]).stdout;
 if(!legacyVerification.includes('Verified using v1 scheme (JAR signing): true')||!verification.includes('Verified using v2 scheme (APK Signature Scheme v2): true')||!verification.includes('Verified using v3 scheme (APK Signature Scheme v3): true'))throw Error('APK签名验证未满足全部v1/v2/v3要求');
 fs.writeFileSync(path.join(build,'signature-verification.txt'),'Target Android range (API26+):\n'+verification+'\nIndependent legacy JAR-scheme verification (forced API23, not app minSdk support):\n'+legacyVerification);
 audit(apk,'signed',true);run(path.join(tools,'zipalign.exe'),['-c','-P','16','4',apk]);
 run(aapt,['dump','badging',apk]);run(aapt,['dump','resources',apk]);
 const out=path.join(root,'android/output',candidate?'candidates':'');fs.mkdirSync(out,{recursive:true});const final=path.join(out,path.basename(apk));if(fs.existsSync(final))copy(final,path.join(out,path.basename(apk,'.apk')+'-'+Date.now()+'.previous.apk'));copy(apk,final);
 const info={version:appVersion.version,versionCode,candidate,uiSource,signatureSchemes:{v1:true,v2:true,v3:true},certificateSha256:(verification.match(/certificate SHA-256 digest: ([a-f0-9]+)/)||[])[1],debug,apk:final,bytes:fs.statSync(final).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(final)).digest('hex'),sdk,build,signingKeyDirectory:keyDir,signature:'Local development certificate; no model credentials embedded',at:new Date().toISOString()};const infoName=candidate?'candidate-build.json':debug?'debug-build.json':'build.json';const infoFile=path.join(out,infoName);if(fs.existsSync(infoFile))copy(infoFile,path.join(out,'build-history-'+Date.now()+'.json'));fs.writeFileSync(infoFile,JSON.stringify(info,null,2)+'\n');copy(path.join(build,'audit-signed.json'),path.join(out,path.basename(apk,'.apk')+'-audit.json'));console.log(JSON.stringify(info,null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
