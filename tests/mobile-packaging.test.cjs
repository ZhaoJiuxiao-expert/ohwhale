'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const code=String.raw`
from pathlib import Path
import tempfile,zipfile,struct,hashlib,sys,importlib.util,json,zlib
root=Path(sys.argv[1]);mode=sys.argv[2];base=Path(tempfile.mkdtemp(prefix='ohwhale-apk-unit-'))
def load(name,file):
 s=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
audit=load('apk_audit',root/'scripts/android-audit.py').audit
normalize=load('apk_normalize',root/'scripts/android-normalize-zip.py').normalize
source=base/'source.apk';target=base/'normalized.apk'
def member(z,name,data,compression=0):
 i=zipfile.ZipInfo(name);i.compress_type=compression;z.writestr(i,data)
with zipfile.ZipFile(source,'x') as z:
 member(z,'AndroidManifest.xml',b'fixture-manifest')
 member(z,'resources.arsc',b'fixture-resource',8 if mode=='compressed' else 0)
 member(z,'classes.dex',b'fixture-dex')
 if mode=='windows':
  i=zipfile.ZipInfo('assets/www/index.html');i.filename='assets\\www\\index.html';i.orig_filename=i.filename;z.writestr(i,b'<html>byte-preserved</html>')
 elif mode=='unsafe':member(z,'assets/../outside',b'not-extracted')
 else:member(z,'assets/www/index.html',b'<html>byte-preserved</html>')
 if mode=='duplicate':member(z,'classes.dex',b'duplicate')
before=source.read_bytes();beforeHash=hashlib.sha256(before).hexdigest()
if mode=='windows':
 first=audit(source,True,False);assert not first['valid'];result=normalize(source,target);assert len(result['normalizedNames'])==1;after=audit(target,True,False);assert after['valid'],after
 with zipfile.ZipFile(target) as z:assert z.read('assets/www/index.html')==b'<html>byte-preserved</html>';assert all('\\' not in i.orig_filename for i in z.infolist())
 assert hashlib.sha256(source.read_bytes()).hexdigest()==beforeHash
elif mode=='compressed':
 r=audit(source,True,False);assert not r['valid'];assert any('uncompressed' in e for e in r['errors'])
elif mode=='alignment':
 r=audit(source,True,True);assert not r['valid'];assert any('4-byte' in e for e in r['errors'])
elif mode=='duplicate':
 r=audit(source,True,False);assert not r['valid'];assert any('Duplicate' in e for e in r['errors'])
elif mode=='unsafe':
 try:normalize(source,target);raise AssertionError('unsafe path accepted')
 except ValueError:pass
 assert not (base/'outside').exists();assert source.read_bytes()==before
elif mode=='crc':
 b=bytearray(before);at=b.index(b'<html>byte-preserved</html>');b[at]=ord('X');source.write_bytes(b);r=audit(source,True,False);assert not r['valid'];assert any('CRC' in e for e in r['errors'])
elif mode=='existing':
 target.write_bytes(b'keep-existing')
 try:normalize(source,target);raise AssertionError('existing destination overwritten')
 except ValueError:pass
 assert target.read_bytes()==b'keep-existing'
print(json.dumps({'mode':mode,'passed':True,'directory':str(base)}))
`;
for(const [mode,title]of Object.entries({windows:'Windows AAPT paths normalize both headers while preserving source and bytes',compressed:'compressed resource tables fail packaging checks',alignment:'unaligned resource tables fail final packaging checks',duplicate:'duplicate archive entries fail packaging checks',unsafe:'normalization never extracts path traversal entries',crc:'CRC corruption is caught before signing',existing:'normalization refuses to overwrite a prior archive'}))test(title,()=>{const r=cp.spawnSync('python',['-c',code,root,mode],{encoding:'utf8',maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(JSON.parse(r.stdout).passed,true);});
