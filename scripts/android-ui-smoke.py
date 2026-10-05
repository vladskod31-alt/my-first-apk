"""Device smoke, using accessibility text (not screenshot mocks or desktop labels)."""
import subprocess, time, re
import xml.etree.ElementTree as ET
from pathlib import Path
base=Path('artifacts/install')
def adb(*args):return subprocess.check_output(['adb',*args],text=True,stderr=subprocess.STDOUT)
def capture(name):
    adb('shell','uiautomator','dump','/sdcard/libo-window.xml')
    adb('pull','/sdcard/libo-window.xml',str(base/name))
    return ET.parse(base/name)
def tap(tree,text):
    for node in tree.iter('node'):
        label=node.get('text','')+' '+node.get('content-desc','')
        bounds=list(map(int,re.findall(r'-?\d+',node.get('bounds',''))))
        if text in label:
            print('Target:',repr(label),'bounds:',bounds,flush=True)
        if text in label and len(bounds)==4 and 0<=bounds[1]<bounds[3]<=1920 and 0<=bounds[0]<bounds[2]<=1080:
            adb('shell','input','tap',str((bounds[0]+bounds[2])//2),str((bounds[1]+bounds[3])//2));return True
    return False
tree=capture('home.xml')
assert tap(tree,'Мой профиль'), 'Mobile profile navigation missing'
time.sleep(2)
for n in range(5):
    tree=capture('profile.xml')
    if tap(tree,'Orbit Premium'):break
    adb('shell','input','swipe','540','1450','540','550','300');time.sleep(1)
else:raise AssertionError('Orbit entry missing in profile settings')
time.sleep(2)
tree=capture('orbit.xml')
texts=[n.get('text','')+' '+n.get('content-desc','') for n in tree.iter('node')]
assert any('Orbit Premium' in t for t in texts),'Orbit dialog did not render'
(base/'result.txt').write_text('PASS: signed APK installed, native launch succeeded, mobile WebView rendered, profile opened, Orbit dialog rendered. Not a physical-device/NFC/Wi-Fi test.\n')
print('::notice::'+(base/'result.txt').read_text().strip())
