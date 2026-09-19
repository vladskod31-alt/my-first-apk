import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This fallback toolchain is for Linux x64. Use the standard Gradle build on other platforms.');
const manifest = JSON.parse(fs.readFileSync(new URL('./toolchain-sources.json', import.meta.url)));
const destination = path.resolve(process.argv[2] || path.join(os.homedir(), '.local/share/libo-toolchain'));
const tools = path.join(destination, 'android');
fs.mkdirSync(tools, { recursive: true });

for (const file of manifest.files) {
  const target = path.join(tools, file.name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const valid = () => fs.existsSync(target) && crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') === file.sha256;
  if (!valid()) {
    console.log(`Fetching pinned build tool: ${file.name}`);
    const descriptor = fs.openSync(target, 'w');
    try {
      execFileSync('gh', ['api', file.githubApi, '-H', 'Accept: application/vnd.github.raw+json'], { stdio: ['ignore', descriptor, 'inherit'] });
    } finally { fs.closeSync(descriptor); }
  }
  if (!valid()) throw new Error(`SHA-256 mismatch for ${file.name}; stop rather than run an unverified tool.`);
  if (['aapt2', 'zipalign'].includes(file.name)) fs.chmodSync(target, 0o755);
}

const runtimeDir = path.join(destination, 'runtime');
const runtimeArchive = path.join(destination, 'runtime.tgz');
const response = await fetch(manifest.runtime.url);
if (!response.ok) throw new Error(`Runtime download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actual = 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
if (actual !== manifest.runtime.integrity) throw new Error('Runtime integrity mismatch.');
fs.writeFileSync(runtimeArchive, bytes);
fs.mkdirSync(runtimeDir, { recursive: true });
execFileSync('tar', ['-xzf', runtimeArchive, '--strip-components=1', '-C', runtimeDir]);
fs.unlinkSync(runtimeArchive);
const javaHome = path.join(runtimeDir, 'jre');
execFileSync(path.join(javaHome, 'bin/java'), ['-version'], { stdio: 'inherit' });
console.log(`\nVerified toolchain downloaded outside the repository.\nexport JAVA_HOME='${javaHome}'\nexport LIBO_TOOLCHAIN='${tools}'\n./scripts/build-apk-local.sh`);
