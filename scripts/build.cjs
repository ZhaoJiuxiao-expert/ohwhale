const fs=require('node:fs');
const path=require('node:path');
const esbuild=require('esbuild');
async function main(){
 const root=path.resolve(__dirname,'..');
 await esbuild.build({entryPoints:[path.join(root,'src/ui/entry.jsx')],bundle:true,outfile:path.join(root,'src/ui/bundle.js'),platform:'browser',target:'chrome130',format:'iife',minify:false,define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff':'file','.woff2':'file','.ttf':'file'},logLevel:'info'});
 const css=path.join(root,'src/ui/bundle.css');
 if(fs.existsSync(css))fs.copyFileSync(css,path.join(root,'src/ui/build.css'));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
