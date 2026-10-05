#!/usr/bin/env python3
"""Surface actual lint errors in GitHub annotations, even if binary log download fails."""
from pathlib import Path
import xml.etree.ElementTree as ET
file=Path('app/build/reports/lint-results-debug.xml')
if not file.exists():
    print('::warning::Android lint report missing; inspect Gradle logs')
else:
    tree=ET.parse(file)
    for issue in tree.findall('issue'):
        if issue.get('severity') not in ['Error','Fatal']:continue
        loc=issue.find('location')
        message=((loc.get('file','')+':'+loc.get('line','')+' ') if loc is not None else '')+(issue.get('id','')+': '+issue.get('message','')).replace('%','%25').replace('\r','%0D').replace('\n','%0A')
        print('::warning::'+message)
