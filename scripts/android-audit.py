"""Read-only APK ZIP/resource checks, run before and after each packaging stage."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import zipfile
import zlib

sys.stdout.reconfigure(encoding="utf-8")

def audit(filename, require_dex=False, require_alignment=False):
    filename=Path(filename)
    raw=filename.read_bytes()
    result={"file":str(filename),"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),"errors":[],"entries":[]}
    with zipfile.ZipFile(filename) as package:
        infos=package.infolist()
        if len(infos)!=len({i.filename for i in infos}): result["errors"].append("Duplicate ZIP entry")
        if sum(i.file_size for i in infos)>160*1024*1024: result["errors"].append("Unpacked APK exceeds audit bound")
        failed=package.testzip()
        if failed: result["errors"].append("ZIP CRC failed: "+failed)
        names={i.filename for i in infos}
        for required in ["AndroidManifest.xml","resources.arsc"]+(["classes.dex"] if require_dex else []):
            if required not in names: result["errors"].append("Missing "+required)
        for item in infos:
            name=item.orig_filename
            if name.startswith("/") or "\\" in name or ".." in name.split("/") or "\0" in name:
                result["errors"].append("Unsafe ZIP name: "+name)
            header=struct.unpack_from("<IHHHHHIIIHH",raw,item.header_offset)
            offset=item.header_offset+30+header[-2]+header[-1]
            local_name=raw[item.header_offset+30:item.header_offset+30+header[-2]]
            if header[0]!=0x04034b50 or local_name.decode("utf-8")!=name:
                result["errors"].append("Local ZIP header/name mismatch: "+name)
            if header[2]&1 or item.flag_bits&1: result["errors"].append("Encrypted ZIP member: "+name)
            if item.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED):
                result["errors"].append("Unsupported ZIP method: "+name)
            if header[3]!=item.compress_type: result["errors"].append("ZIP compression header mismatch: "+name)
            if not header[2]&8 and (header[6]!=item.CRC or header[7]!=item.compress_size or header[8]!=item.file_size):
                result["errors"].append("ZIP size/CRC header mismatch: "+name)
            if name=="resources.arsc":
                if item.compress_type!=zipfile.ZIP_STORED: result["errors"].append("resources.arsc must be uncompressed")
                if require_alignment and offset%4: result["errors"].append("resources.arsc must be 4-byte aligned")
            if require_alignment and name.startswith("lib/") and name.endswith(".so") and item.compress_type==zipfile.ZIP_STORED and offset%16384:
                result["errors"].append("Native library must be 16 KiB aligned: "+name)
            if name in ("resources.arsc","AndroidManifest.xml","classes.dex") or name.startswith("res/"):
                result["entries"].append({"name":name,"compression":item.compress_type,"bytes":item.file_size,"dataOffset":offset,"dataOffsetMod4":offset%4})
            if name.endswith("app_icon.png"):
                data=package.read(item)
                if data[:8]!=b"\x89PNG\r\n\x1a\n": result["errors"].append("Icon is not a real PNG")
                else:
                    at=8;ended=False;width=height=0
                    while at+12<=len(data):
                        size=struct.unpack_from(">I",data,at)[0]
                        if at+12+size>len(data): result["errors"].append("Truncated icon PNG");break
                        kind=data[at+4:at+8];payload=data[at+8:at+8+size]
                        crc=struct.unpack_from(">I",data,at+8+size)[0]
                        if zlib.crc32(kind+payload)&0xffffffff!=crc: result["errors"].append("Icon PNG chunk CRC mismatch")
                        if kind==b"IHDR": width,height=struct.unpack_from(">II",payload)
                        if kind==b"IEND":ended=True;break
                        at+=size+12
                    if not ended or not(1<=width<=4096 and 1<=height<=4096): result["errors"].append("Icon PNG dimensions/end invalid")
                    result["icon"]={"width":width,"height":height,"bytes":len(data)}
        result["entryCount"]=len(infos)
        result["nativeLibraries"]=[i.filename for i in infos if i.filename.startswith("lib/") and i.filename.endswith(".so")]
    result["valid"]=not result["errors"]
    return result

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("apk")
    parser.add_argument("--require-dex",action="store_true")
    parser.add_argument("--require-alignment",action="store_true")
    parser.add_argument("--output")
    args=parser.parse_args()
    try: result=audit(args.apk,args.require_dex,args.require_alignment)
    except Exception as exc: result={"file":args.apk,"valid":False,"errors":[str(exc)]}
    if args.output: Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"file":result["file"],"valid":result["valid"],"errors":result["errors"],"entryCount":result.get("entryCount")},ensure_ascii=False))
    sys.exit(0 if result["valid"] else 1)
