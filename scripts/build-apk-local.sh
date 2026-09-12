#!/usr/bin/env bash
# Private, side-by-side preview build when Gradle repositories are unavailable.
# Tool inputs are external to Git; see scripts/toolchain-sources.json.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
: "${LIBO_TOOLCHAIN:?Set LIBO_TOOLCHAIN to the directory containing android.jar, aapt2, ecj.jar, d8.jar, apksigner.jar and zipalign}"
: "${JAVA_HOME:?Set JAVA_HOME to a Java 17 JRE or JDK}"
JAVA="$JAVA_HOME/bin/java"
KEYTOOL="$JAVA_HOME/bin/keytool"
for file in android.jar aapt2 ecj.jar d8.jar apksigner.jar zipalign; do
  test -f "$LIBO_TOOLCHAIN/$file" || { echo "Missing tool: $file"; exit 1; }
done
WORK="$ROOT/build/manual-apk"
rm -rf "$WORK"
mkdir -p "$WORK/res" "$WORK/java" "$WORK/classes" "$WORK/dex" "$ROOT/artifacts"
export LIBO_APP_ID="${LIBO_APP_ID:-app.libo.messenger.preview23}"
export LIBO_APK_SUFFIX="${LIBO_APK_SUFFIX:--preview}"
# The original beta signing key is not available in this environment. Never replace it with a new key.
if [ "$LIBO_APP_ID" != 'app.libo.messenger.preview23' ] && [ ! -f "${LIBO_KEYSTORE:-/nonexistent}" ]; then
  echo 'An existing private signing keystore is required for a non-preview application ID.' >&2
  exit 1
fi
cp -R app/src/main/res/. "$WORK/res/"
if [ "$LIBO_APP_ID" = 'app.libo.messenger.preview23' ]; then cp -R app/src/debug/res/. "$WORK/res/"; fi
export LIBO_VERSION
LIBO_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
export LIBO_VERSION_CODE
LIBO_VERSION_CODE=$(node -p "require('fs').readFileSync('app/build.gradle','utf8').match(/versionCode\s+(\d+)/)[1]")
npm run build
python3 - <<'PY'
import os
import xml.etree.ElementTree as ET
from pathlib import Path
ns = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ns)
tree = ET.parse('app/src/main/AndroidManifest.xml')
root = tree.getroot()
root.set('package', os.environ['LIBO_APP_ID'])
root.set('{'+ns+'}versionCode', os.environ['LIBO_VERSION_CODE'])
root.set('{'+ns+'}versionName', os.environ['LIBO_VERSION'])
app = root.find('application')
app.set('{'+ns+'}debuggable', 'false')
app.find('activity').set('{'+ns+'}name', 'app.libo.messenger.MainActivity')
tree.write('build/manual-apk/AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
Path('build/manual-apk/java/BuildConfig.java').write_text('package app.libo.messenger; public final class BuildConfig { public static final boolean DEBUG = false; }\n')
PY
"$LIBO_TOOLCHAIN/aapt2" compile --dir "$WORK/res" -o "$WORK/resources.zip"
"$LIBO_TOOLCHAIN/aapt2" link -o "$WORK/resources.apk" \
  --manifest "$WORK/AndroidManifest.xml" -I "$LIBO_TOOLCHAIN/android.jar" \
  --min-sdk-version 26 --target-sdk-version 35 --custom-package app.libo.messenger \
  --java "$WORK/java" -A dist "$WORK/resources.zip"
# Android APIs used by the shell need no Java 17 language features. Compile Java 8
# bytecode, then let D8 convert it to DEX for minSdk 26.
mapfile -t SOURCES < <(find app/src/main/java "$WORK/java" -name '*.java' -type f | sort)
"$JAVA" -jar "$LIBO_TOOLCHAIN/ecj.jar" -source 1.8 -target 1.8 -proc:none \
  -encoding UTF-8 -bootclasspath "$LIBO_TOOLCHAIN/android.jar" -d "$WORK/classes" "${SOURCES[@]}"
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
base = Path('build/manual-apk/classes')
with ZipFile('build/manual-apk/classes.jar', 'w', ZIP_DEFLATED) as archive:
    for file in sorted(base.rglob('*.class')):
        archive.write(file, file.relative_to(base).as_posix())
PY
"$JAVA" -cp "$LIBO_TOOLCHAIN/d8.jar" com.android.tools.r8.D8 \
  --min-api 26 --lib "$LIBO_TOOLCHAIN/android.jar" --output "$WORK/dex" "$WORK/classes.jar"
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
with ZipFile('build/manual-apk/resources.apk', 'a', ZIP_DEFLATED) as archive:
    for file in sorted(Path('build/manual-apk/dex').glob('*.dex')):
        archive.write(file, file.name)
PY
"$LIBO_TOOLCHAIN/zipalign" -f 4 "$WORK/resources.apk" "$WORK/aligned.apk"
SIGNING_HOME="${LIBO_SIGNING_HOME:-$HOME/libo-private-signing-23}"
KEYSTORE="${LIBO_KEYSTORE:-$SIGNING_HOME/preview.keystore}"
PASSWORD_FILE="${LIBO_KEY_PASSWORD_FILE:-$SIGNING_HOME/preview.password}"
if [ -z "${LIBO_DEBUG_PASSWORD:-}" ]; then
  if [ ! -f "$PASSWORD_FILE" ]; then
    mkdir -p "$SIGNING_HOME"; chmod 700 "$SIGNING_HOME"
    if [ -f "$KEYSTORE" ]; then echo 'Provide LIBO_KEY_PASSWORD_FILE or LIBO_DEBUG_PASSWORD for the existing keystore.' >&2; exit 1; fi
    (umask 077; node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" > "$PASSWORD_FILE")
  fi
  LIBO_DEBUG_PASSWORD=$(cat "$PASSWORD_FILE")
fi
export LIBO_DEBUG_PASSWORD
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  "$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -alias libo-beta \
    -storepass:env LIBO_DEBUG_PASSWORD -keypass:env LIBO_DEBUG_PASSWORD \
    -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=LIBO Preview,O=LIBO' -noprompt
  chmod 600 "$KEYSTORE"
fi
APK="$ROOT/artifacts/LIBO-$LIBO_VERSION$LIBO_APK_SUFFIX.apk"
"$JAVA" -jar "$LIBO_TOOLCHAIN/apksigner.jar" sign --ks "$KEYSTORE" --ks-key-alias libo-beta \
  --ks-pass env:LIBO_DEBUG_PASSWORD --key-pass env:LIBO_DEBUG_PASSWORD \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$APK" "$WORK/aligned.apk"
"$JAVA" -jar "$LIBO_TOOLCHAIN/apksigner.jar" verify --verbose --print-certs "$APK"
"$LIBO_TOOLCHAIN/zipalign" -c 4 "$APK"
"$LIBO_TOOLCHAIN/aapt2" dump badging "$APK" > "$ROOT/artifacts/APK-INFO.txt"
(cd artifacts && sha256sum "LIBO-$LIBO_VERSION$LIBO_APK_SUFFIX.apk" > SHA256SUMS.txt)
echo "Verified private preview APK: $APK"
