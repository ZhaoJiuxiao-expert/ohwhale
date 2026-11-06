"""Archive only a fresh, unconfigured network deployment whitelist; no upload."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile

FILES = {'.dockerignore','README.md','IP-HTTPS.md','UBUNTU-BOOTSTRAP.md','compose.yaml','compose.ip.yaml','configure.cjs','ip-https.cjs','preflight.cjs','prepare-friends-data.cjs','bootstrap-ubuntu2204.sh','deploy-ubuntu2204.sh','server/signaling.cjs','server/friends.cjs','server/managed-ai.cjs','server/managed-models.json','compose.managed.yaml','compose.update-managed.yaml','update-managed-1.3.sh','prepare-managed-data.cjs','server/check.html','server/check.js','server/Dockerfile','src/p2p/network.js','src/p2p/peer.js'}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle',required=True)
    parser.add_argument('--output',help='New tar.gz filename; default is adjacent to bundle')
    args=parser.parse_args()
    bundle=Path(args.bundle).resolve()
    actual=set()
    for item in bundle.rglob('*'):
        if item.is_symlink() or getattr(item,'is_junction',lambda:False)(): raise ValueError('Links are not permitted')
        if item.is_file(): actual.add(item.relative_to(bundle).as_posix())
    if actual != FILES: raise ValueError('Expected an exact fresh deployment whitelist; configured/runtime or missing files refused')
    output=Path(args.output).resolve() if args.output else bundle.with_name(bundle.name+'.tar.gz')
    side=Path(str(output)+'.sha256')
    if output.exists() or side.exists(): raise ValueError('Preserving existing archive/checksum; choose a new output')
    contents={name:(bundle/name).read_bytes() for name in sorted(FILES)}
    with tarfile.open(output,'x:gz',format=tarfile.USTAR_FORMAT) as archive:
        for name,data in contents.items():
            info=tarfile.TarInfo('ohwhale-network/'+name)
            info.size=len(data); info.uid=info.gid=info.mtime=0
            info.mode=0o755 if name.endswith('.sh') else 0o644
            archive.addfile(info,io.BytesIO(data))
    with tarfile.open(output,'r:gz') as archive:
        members=archive.getmembers()
        if len(members)!=len(FILES): raise ValueError('Archive member count mismatch')
        for member in members:
            name=member.name.removeprefix('ohwhale-network/')
            if not member.isfile() or name not in contents or archive.extractfile(member).read()!=contents[name]: raise ValueError('Archive readback mismatch')
    digest=hashlib.sha256(output.read_bytes()).hexdigest()
    with side.open('x',encoding='ascii') as stream: stream.write(digest+'  '+output.name+'\n')
    print(json.dumps({'prepared':True,'archive':str(output),'sha256':digest,'checksum':str(side),'files':len(FILES),'includesUserData':False,'uploaded':False}))

if __name__=='__main__': main()
