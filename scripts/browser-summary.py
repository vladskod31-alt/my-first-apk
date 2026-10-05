from pathlib import Path
import json
p=Path('test-results/report.json')
if p.exists():
    data=json.loads(p.read_text())
    print('::notice::Browser stats: '+json.dumps(data.get('stats',{})))
    def walk(s):
        for spec in s.get('specs',[]):
            for test in spec.get('tests',[]):
                for result in test.get('results',[]):
                    if result.get('status') in ['failed','timedOut']:
                        msg=spec.get('title','')+' '+json.dumps(result.get('errors',[]),ensure_ascii=False)
                        print('::warning::'+msg[:10000].replace('%','%25').replace('\r','%0D').replace('\n','%0A'))
        for child in s.get('suites',[]):walk(child)
    walk(data)
