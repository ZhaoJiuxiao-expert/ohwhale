"""Install verified official Android tools into a task-local user cache."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
SDK = Path(os.environ.get("OHWHALE_ANDROID_SDK", str(Path.home()/".cache"/"ohwhale-android-sdk"))).resolve()
DOWNLOAD = "https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip"
SHA256 = "90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a"
SDK.mkdir(parents=True, exist_ok=True)
archive = SDK/"commandlinetools-win-15859902_latest.zip"
if not archive.exists():
    print("Downloading official Android command-line tools", flush=True)
    with urllib.request.urlopen(DOWNLOAD, timeout=120) as response, archive.open("xb") as target:
        while chunk := response.read(1024*1024):
            target.write(chunk)
if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
    raise RuntimeError("Android tool archive checksum mismatch; preserved for inspection")
tool = SDK/"cmdline-tools"/"latest"
if not (tool/"bin"/"sdkmanager.bat").exists():
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            relative = Path(*Path(member.filename).parts[1:])
            destination = (tool/relative).resolve()
            if not destination.is_relative_to(tool.resolve()):
                raise RuntimeError("Unsafe archive entry")
            if member.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    destination.write_bytes(package.read(member))
print("SDK root:", SDK, flush=True)
manager = str(tool/"bin"/"sdkmanager.bat")
env = dict(os.environ)
env["ANDROID_SDK_ROOT"] = str(SDK)
# Let the person installing the SDK review and accept its licenses.
subprocess.run([manager, f"--sdk_root={SDK}", "--licenses"], env=env, check=True)
packages = ["platform-tools", "platforms;android-35", "build-tools;35.0.0"]
if "--emulator" in sys.argv:
    packages += ["emulator", "system-images;android-35;google_apis;x86_64"]
result = subprocess.run([manager, f"--sdk_root={SDK}", *packages], text=True, env=env)
print(json.dumps({"sdk":str(SDK),"packages":packages,"exitCode":result.returncode}), flush=True)
sys.exit(result.returncode)
