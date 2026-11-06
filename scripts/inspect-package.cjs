const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const req=createRequire(require.resolve('@electron/packager')),asar=req('@electron/asar'),root=path.resolve(__dirname,'..');
const latest=fs.readdirSync(path.join(root,'artifacts')).filter(f=>/^package-\d+\.json$/.test(f)).sort().at(-1);
const recordPath=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'artifacts',latest),record=JSON.parse(fs.readFileSync(recordPath));
const dir=record.dirs[0],archive=path.join(dir,'resources/app.asar');const files=asar.listPackage(archive),data=fs.readFileSync(archive),text=data.toString('utf8');
const packedVersion=JSON.parse(asar.extractFile(archive,'package.json')).version;
if(packedVersion!==record.version||packedVersion!==require('../package.json').version)throw Error('Packaged version does not match source/release record');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceFiles=[];
function verifySource(dirPath){for(const entry of fs.readdirSync(dirPath,{withFileTypes:true})){const file=path.join(dirPath,entry.name);if(entry.isDirectory())verifySource(file);else if(entry.isFile()){const relative=path.relative(root,file),expected=sha(fs.readFileSync(file)),actual=sha(asar.extractFile(archive,relative));if(expected!==actual)throw Error('Packaged source mismatch: '+relative);sourceFiles.push({path:relative,sha256:actual});}}}
verifySource(path.join(root,'src'));
if(/apikey-[a-z0-9]{20,}|sk-[a-zA-Z0-9_-]{24,}/i.test(text))throw Error('Potential secret pattern in distributable');
if(files.some(f=>/snapshot-|api-usage\.jsonl|ask\.py|run-live-qa|profile[\\/]|qq-analysis/i.test(f)))throw Error('Private development evidence included');
if(!fs.existsSync(path.join(dir,'resources/app.asar.unpacked/src/speech.ps1')))throw Error('Speech helper missing');
const catalog=JSON.parse(asar.extractFile(archive,path.join('src','data','stickers.json')));for(const item of catalog){const b=asar.extractFile(archive,path.join('src','ui',...item.src.split('/')));if(crypto.createHash('sha256').update(b).digest('hex')!==item.sha256)throw Error('Sticker mismatch');}
const report={passed:true,dir,at:new Date().toISOString(),packageRecord:recordPath,version:packedVersion,files:files.length,sourceFilesMatched:sourceFiles.length,sourceFiles,stickers:catalog.length,characters:new Set(catalog.map(i=>i.character)).size,secretPatternScan:'no matches; user profiles/logs/developer key reader not bundled',speechUnpacked:true,asarSHA256:sha(data),exeSHA256:sha(fs.readFileSync(path.join(dir,'OhWhale.exe')))};
fs.writeFileSync(path.join(root,'artifacts',`package-inspection-${Date.now()}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
