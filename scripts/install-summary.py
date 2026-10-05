from pathlib import Path
import xml.etree.ElementTree as ET
base=Path('artifacts/install')
for name in ['install.txt','launch.txt','runtime.txt','ui-smoke.txt','result.txt']:
    file=base/name
    text=file.read_text(errors='replace') if file.exists() else 'Not recorded'
    text=(name+': '+text[:12000]).replace('%','%25').replace('\n','%0A').replace('\r','%0D')
    print('::warning::'+text)
for file in base.glob('*.xml'):
    try:
        texts=[n.get('text','')+' '+n.get('content-desc','') for n in ET.parse(file).iter('node')]
        text=file.name+': '+' | '.join(t.strip() for t in texts if t.strip())
        print('::warning::'+text[:16000].replace('%','%25').replace('\n','%0A').replace('\r','%0D'))
    except Exception as e:print('::warning::'+str(e))
