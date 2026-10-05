#!/usr/bin/env python3
"""Verify artwork INSIDE the built APK, not merely files in the source tree.
Usage: python3 scripts/verify-apk-icons.py artifacts/LIBO-2.8.8.apk
Requires Pillow, and LIBO_TOOLCHAIN/aapt2 (or AAPT2 env path).
"""
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from PIL import Image, ImageChops
import hashlib, json, os, subprocess, sys, re
root=Path(__file__).resolve().parent.parent
apk=Path(sys.argv[1])
aapt=os.environ.get('AAPT2', str(Path(os.environ['LIBO_TOOLCHAIN'])/'aapt2'))
def dump(*args):return subprocess.check_output([aapt,'dump',*args,str(apk)],text=True)
badging=dump('badging')
version=re.search(r"versionName\s+'([^']+)'",(root/'app/build.gradle').read_text()).group(1)
assert f"versionName='{version}'" in badging
assert "application-icon-160:'res/mipmap-anydpi-v26/ic_launcher.xml'" in badging
assert "launchable-activity: name='app.libo.messenger.MainActivity'" in badging
resources=dump('resources')
foreground=re.search(r'resource (0x[0-9a-f]+) mipmap/ic_launcher_foreground', resources).group(1)
for path in ['res/mipmap-anydpi-v26/ic_launcher.xml','res/mipmap-anydpi-v26/ic_launcher_round.xml','res/drawable/ic_splash_logo.xml']:
    xml=dump('xmltree','--file',path)
    assert '@'+foreground in xml, path
report={'apk':apk.name,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'checks':[],'device_install_tested':False}
with ZipFile(apk) as z:
    files=z.namelist()
    for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
        for name,expected in [('ic_launcher.png',size),('ic_launcher_round.png',size),('ic_launcher_foreground.png',int(size*108/48))]:
            matches=[p for p in files if p.startswith('res/') and p.split('/')[1] in ['mipmap-'+density, 'mipmap-'+density+'-v4'] and p.endswith('/'+name)]
            assert len(matches)==1,(density,name,matches)
            image=Image.open(BytesIO(z.read(matches[0]))).convert('RGBA')
            original=Image.open(root/f'app/src/main/res/mipmap-{density}'/name).convert('RGBA')
            assert image.size==(expected,expected)
            # AAPT may zero invisible RGB under fully transparent round corners.
            assert image.getchannel('A').tobytes() == original.getchannel('A').tobytes()
            for bg in ['white','black']:
                a=Image.new('RGBA',image.size,bg);a.alpha_composite(image)
                b=Image.new('RGBA',image.size,bg);b.alpha_composite(original)
                assert a.tobytes() == b.tobytes(), matches[0]
            report['checks'].append({'path':matches[0],'size':image.size,'source_pixels_match':True})
    assert z.read('assets/icon-192.png')==(root/'web/public/icon-192.png').read_bytes()
    # Extract a deliverable preview straight out of the APK for visual inspection.
    path=next(p for p in files if p.startswith('res/') and p.split('/')[1] in ['mipmap-xxxhdpi', 'mipmap-xxxhdpi-v4'] and p.endswith('/ic_launcher.png'))
    (apk.parent/'ICON-FROM-APK.png').write_bytes(z.read(path))
    assert 'classes.dex' in files and 'assets/index.html' in files
report['checks'].append({'web_icon_matches':True,'dex_and_web_assets':True,'launcher_references_adaptive_resource':True})
(apk.parent/'ICON-VERIFICATION.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
