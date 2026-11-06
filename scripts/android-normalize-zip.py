"""Normalize Windows AAPT asset separators into one canonical unsigned ZIP.

Rebuild both local and central headers together; never rewrite a signed APK.
This deliberately avoids ZipFile append rewriting only central filenames.
"""
import argparse
import json
from pathlib import Path
import zipfile

def normalize(source,destination):
    if Path(destination).exists(): raise ValueError("Destination already exists")
    changed=[]
    with zipfile.ZipFile(source) as original:
        failed=original.testzip()
        if failed: raise ValueError("Input CRC mismatch: "+failed)
        if sum(i.file_size for i in original.infolist())>160*1024*1024: raise ValueError("Archive too large")
        names=set()
        with zipfile.ZipFile(destination,"x",allowZip64=False) as target:
            for old in original.infolist():
                name=old.orig_filename.replace("\\","/")
                if name.startswith("/") or ".." in name.split("/") or "\0" in name or name in names:
                    raise ValueError("Unsafe/duplicate normalized entry")
                names.add(name)
                if name!=old.orig_filename: changed.append({"before":old.orig_filename,"after":name})
                if old.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED): raise ValueError("Unsupported ZIP method")
                new=zipfile.ZipInfo(name,old.date_time)
                new.compress_type=zipfile.ZIP_STORED if name=="resources.arsc" else old.compress_type
                new.external_attr=old.external_attr
                new.comment=old.comment
                target.writestr(new,original.read(old))
    with zipfile.ZipFile(destination) as result:
        failed=result.testzip()
        if failed: raise ValueError("Normalized CRC mismatch: "+failed)
    return {"source":str(source),"destination":str(destination),"normalizedNames":changed,"sourcePreserved":True,"inputCRCValid":True,"outputCRCValid":True}

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("--output")
    args=parser.parse_args()
    result=normalize(args.source,args.destination)
    if args.output: Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"normalizedEntries":len(result["normalizedNames"]),"inputCRCValid":True,"outputCRCValid":True}))
