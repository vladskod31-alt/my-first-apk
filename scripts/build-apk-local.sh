#!/usr/bin/env bash
# Alternative beta build when GitHub Actions / Gradle repositories are unavailable.
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
root.set('package', 'app.libo.messenger.beta')
root.set('{'+ns+'}versionCode', os.environ['LIBO_VERSION_CODE'])
root.set('{'+ns+'}versionName', os.environ['LIBO_VERSION'])
app = root.find('application')
app.set('{'+ns+'}debuggable', 'true')
app.find('activity').set('{'+ns+'}name', 'app.libo.messenger.MainActivity')
tree.write('build/manual-apk/AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
Path('build/manual-apk/java/BuildConfig.java').write_text('package app.libo.messenger; public final class BuildConfig { public static final boolean DEBUG = true; }\n')
PY
"$LIBO_TOOLCHAIN/aapt2" compile --dir app/src/main/res -o "$WORK/resources.zip"
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
KEYSTORE="${LIBO_KEYSTORE:-$HOME/.local/share/libo/debug.keystore}"
export LIBO_DEBUG_PASSWORD="${LIBO_DEBUG_PASSWORD:-android}"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  "$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -alias libo-beta \
    -storepass:env LIBO_DEBUG_PASSWORD -keypass:env LIBO_DEBUG_PASSWORD \
    -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=LIBO Beta,O=LIBO' -noprompt
  chmod 600 "$KEYSTORE"
fi
APK="$ROOT/artifacts/LIBO-$LIBO_VERSION.apk"
"$JAVA" -jar "$LIBO_TOOLCHAIN/apksigner.jar" sign --ks "$KEYSTORE" --ks-key-alias libo-beta \
  --ks-pass env:LIBO_DEBUG_PASSWORD --key-pass env:LIBO_DEBUG_PASSWORD \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$APK" "$WORK/aligned.apk"
"$JAVA" -jar "$LIBO_TOOLCHAIN/apksigner.jar" verify --verbose --print-certs "$APK"
"$LIBO_TOOLCHAIN/zipalign" -c 4 "$APK"
"$LIBO_TOOLCHAIN/aapt2" dump badging "$APK" > "$ROOT/artifacts/APK-INFO.txt"
(cd artifacts && sha256sum "LIBO-$LIBO_VERSION.apk" > SHA256SUMS.txt)
echo "Verified beta APK: $APK"
