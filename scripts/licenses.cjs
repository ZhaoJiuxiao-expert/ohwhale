const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'licenses');fs.mkdirSync(out,{recursive:true});
const dependencies=['@chatscope/chat-ui-kit-react','@chatscope/chat-ui-kit-styles','react','react-dom','lucide-react','electron','qrcode','jsqr','three'];
for(const name of dependencies){
 // three deliberately does not export its package.json; resolve the CJS entry.
 const dir=name==='three'?path.resolve(path.dirname(require.resolve(name)),'..'):path.dirname(require.resolve(`${name}/package.json`));const file=fs.readdirSync(dir).find(f=>/^licen[cs]e(?:\.md|\.txt)?$/i.test(f));if(!file)throw Error(`License not found: ${name}`);
 const version=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8')).version;
 const dest=path.join(out,name.replace(/[@/]/g,'_')+(['qrcode','jsqr','three'].includes(name)?'-'+version:'')+'-LICENSE.txt');fs.copyFileSync(path.join(dir,file),dest);
}console.log(`Collected ${dependencies.length} dependency licenses.`);
