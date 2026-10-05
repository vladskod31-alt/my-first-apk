from pathlib import Path
for name in ['install.txt','launch.txt','runtime.txt','window.xml']:
    file=Path('artifacts/install')/name
    text=file.read_text(errors='replace') if file.exists() else 'NO REPORT: emulator command did not reach this step'
    text=(name+': '+text[:20000]).replace('%','%25').replace('\n','%0A').replace('\r','%0D')
    print('::warning::'+text)
