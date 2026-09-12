// Local preview delivery. Only the requested APK, ZIP and prepared offline page are served.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const nonce = randomBytes(24).toString('hex');
const files = new Map([
  ['/LIBO-2.3.apk', { file: path.join(root, 'LIBO-2.3.apk'), mime: 'application/vnd.android.package-archive' }],
  ['/LIBO-2.3.zip', { file: path.join(root, 'LIBO-2.3.zip'), mime: 'application/zip' }],
]);
for (const value of files.values()) { const bytes = fs.readFileSync(value.file); value.size = bytes.length; value.sha256 = createHash('sha256').update(bytes).digest('hex'); }
const manifest = [...files].map(([url, f]) => ({ url: '.' + url, name: path.basename(f.file), size: f.size, sha256: f.sha256 }));
const page = Buffer.from(`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Завантажити LIBO 2.3</title><style>*{box-sizing:border-box}body{margin:0;padding:28px 16px;background:#211235;color:#fff;font:16px/1.55 system-ui}main{max-width:460px;margin:0 auto}h1{font-size:32px;line-height:1.2}.card{background:#342345;padding:22px;margin:18px 0;border:1px solid #5a426d;border-radius:24px}a,button{display:block;width:100%;border:0;padding:17px 12px;background:#c5ff3b;color:#211235;border-radius:999px;text-align:center;font:750 18px system-ui;text-decoration:none;cursor:pointer}a.secondary{background:#9a66d5;color:white}.note{font-size:13px;color:#cabcd4}#verify{font-size:14px;background:#584069;color:white;margin-top:22px}#result{white-space:pre-wrap;font-size:13px}</style><main><h1>Твоя LIBO 2.3</h1><p class="note">Два варіанти того самого APK. Обери потрібний.</p><section class="card"><a id="apk" href="./LIBO-2.3.apk" target="_blank" rel="noopener" download="LIBO-2.3.apk">⬇ APK без архіву · 8,4 МБ</a><p class="note">Готовий файл для встановлення на Android.</p></section><section class="card"><a id="zip" class="secondary" href="./LIBO-2.3.zip" target="_blank" rel="noopener" download="LIBO-2.3.zip">⬇ ZIP з APK · 7,7 МБ</a><p class="note">Усередині лише LIBO-2.3.apk. Розпакуй і встанови.</p></section><button id="verify">Перевірити завантаження на цьому телефоні</button><p class="note">Перевірка прочитає обидва файли та порівняє контрольні суми. Це приблизно 16 МБ трафіку.</p><p id="result" role="status"></p><p class="note">Поточна збірка поки з попередньою іконкою. Хмарні функції потребують власного сервера. Стару програму з перепискою не видаляй.</p></main><script>
const files=${JSON.stringify(manifest)},nonce=${JSON.stringify(nonce)};
function cleanUrl(value){try{const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'?u.origin+u.pathname:''}catch{return ''}}
async function report(values){try{await fetch(new URL('./__delivery-check',document.baseURI),{method:'POST',headers:{'Content-Type':'application/json','X-Libo-Check':nonce},body:JSON.stringify({base:cleanUrl(document.baseURI),...values})})}catch{}}
(async()=>{const checks=[];for(const file of files){try{const u=new URL(file.url,document.baseURI);const r=await fetch(u,{method:'HEAD',cache:'no-store'});checks.push({name:file.name,url:cleanUrl(u.href),status:r.status,size:Number(r.headers.get('content-length'))})}catch{checks.push({name:file.name,status:0})}}await report({kind:'head',checks})})();
document.querySelector('#verify').onclick=async()=>{const button=document.querySelector('#verify'),result=document.querySelector('#result');button.disabled=true;result.textContent='Перевіряємо…';const checks=[];try{for(const file of files){const u=new URL(file.url,document.baseURI),r=await fetch(u,{cache:'no-store'});if(!r.ok)throw Error(file.name+': HTTP '+r.status);const bytes=await r.arrayBuffer();const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');const ok=bytes.byteLength===file.size&&sha===file.sha256;checks.push({name:file.name,url:cleanUrl(u.href),status:r.status,size:bytes.byteLength,sha256:sha,ok});if(!ok)throw Error('Файл не збігається з оригіналом: '+file.name)}result.textContent='Обидва файли повністю отримані й перевірені на цьому пристрої. Натисни APK або ZIP вище, щоб зберегти.';await report({kind:'verified',checks})}catch(error){result.textContent='Перевірка не пройшла: '+error.message;await report({kind:'failed',checks})}finally{button.disabled=false}};
</script></html>`);
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://preview.invalid').pathname;
  const common = { 'Cache-Control': 'private, no-store, no-transform', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (pathname === '/__delivery-check' && req.method === 'POST') {
    if (req.headers['x-libo-check'] !== nonce) { res.writeHead(403); res.end(); return; }
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 6000) req.destroy(); });
    req.on('end', () => {
      try {
        const report = JSON.parse(body);
        const safeUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.origin + u.pathname : ''; } catch { return ''; } };
        const clean = { kind: ['head', 'verified', 'failed'].includes(report.kind) ? report.kind : 'unknown', base: safeUrl(report.base), checks: (Array.isArray(report.checks) ? report.checks : []).slice(0, 2).map(c => ({ name: String(c.name).slice(0, 40), url: safeUrl(c.url), status: Number(c.status), size: Number(c.size), sha256: /^[a-f0-9]{64}$/.test(c.sha256 || '') ? c.sha256 : '', ok: c.ok === true })) };
        fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
        fs.writeFileSync(path.join(root, '.cache/browser-download-check.json'), JSON.stringify(clean, null, 2));
        console.log('BROWSER_DOWNLOAD_CHECK ' + clean.kind + ' ' + clean.base);
        res.writeHead(204, common); res.end();
      } catch { res.writeHead(400); res.end(); }
    }); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { ...common, 'Content-Length': '0' }); res.end(); return; }
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length }); res.end(req.method === 'HEAD' ? undefined : page); return;
  }
  const entry = files.get(pathname);
  if (!entry) { res.writeHead(404, { ...common, 'Content-Length': '0' }); res.end(); return; }
  let start = 0, end = entry.size - 1, partial = false;
  if (req.headers.range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (match) { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), entry.size - 1); }
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= entry.size) { res.writeHead(416, { ...common, 'Content-Range': 'bytes */' + entry.size, 'Content-Length': '0' }); res.end(); return; }
    partial = true;
  }
  res.writeHead(partial ? 206 : 200, { ...common, 'Content-Type': entry.mime, 'Content-Disposition': 'attachment; filename="' + path.basename(entry.file) + '"', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(partial ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + entry.size } : {}) });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(entry.file, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
});
const port = Number(process.env.LIBO_DOWNLOAD_PORT || 8787);
server.listen(port, '0.0.0.0', () => console.log('LIBO APK + ZIP download page ready on 0.0.0.0:' + port));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
