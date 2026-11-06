const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'licenses');fs.mkdirSync(out,{recursive:true});
for(const name of ['@chatscope/chat-ui-kit-react','@chatscope/chat-ui-kit-styles','react','react-dom','lucide-react','electron']){
 const dir=path.dirname(require.resolve(`${name}/package.json`));const file=fs.readdirSync(dir).find(f=>/^licen[cs]e(?:\.md|\.txt)?$/i.test(f));if(!file)throw Error(`License not found: ${name}`);
 const dest=path.join(out,name.replace(/[@/]/g,'_')+'-LICENSE.txt');fs.copyFileSync(path.join(dir,file),dest);
}console.log('Collected six dependency licenses.');
