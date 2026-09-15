#!/usr/bin/env bash
# Builds and signs the LIBO APK without Gradle, for environments where the Android
# SDK / Gradle repositories are unreachable (see scripts/toolchain-sources.json for
# the pinned external toolchain). GitHub Actions uses Gradle; see .github/workflows.
#
# LIBO_BUILD_TYPE=release (default): package app.libo.messenger, debuggable=false,
#   signed with the release keystore in LIBO_KEYSTORE (v1+v2+v3).
# LIBO_BUILD_TYPE=debug: legacy beta behaviour (package suffix .beta, debuggable=true).
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
: "${LIBO_TOOLCHAIN:?Set LIBO_TOOLCHAIN to the directory containing android.jar, aapt2, ecj.jar, d8.jar, apksigner.jar and zipalign}"
: "${JAVA_HOME:?Set JAVA_HOME to a Java 17 JRE or JDK}"
JAVA="$JAVA_HOME/bin/java"
KEYTOOL="$JAVA_HOME/bin/keytool"
BUILD_TYPE="${LIBO_BUILD_TYPE:-release}"
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
if [ "$BUILD_TYPE" = release ]; then
  PACKAGE='app.libo.messenger'
  DEBUGGABLE='false'
  DEBUG_FLAG='false'
else
  PACKAGE='app.libo.messenger.beta'
  DEBUGGABLE='true'
  DEBUG_FLAG='true'
fi
npm run build
python3 - "$PACKAGE" "$DEBUGGABLE" "$DEBUG_FLAG" <<'PY'
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
package, debuggable, debug_flag = sys.argv[1], sys.argv[2], sys.argv[3]
ns = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ns)
tree = ET.parse('app/src/main/AndroidManifest.xml')
root = tree.getroot()
root.set('package', package)
root.set('{'+ns+'}versionCode', os.environ['LIBO_VERSION_CODE'])
root.set('{'+ns+'}versionName', os.environ['LIBO_VERSION'])
app = root.find('application')
app.set('{'+ns+'}debuggable', debuggable)
app.find('activity').set('{'+ns+'}name', 'app.libo.messenger.MainActivity')
tree.write('build/manual-apk/AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
Path('build/manual-apk/java/BuildConfig.java').write_text(
    'package app.libo.messenger; public final class BuildConfig { public static final boolean DEBUG = ' + debug_flag + '; }\n')
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

if [ "$BUILD_TYPE" = release ]; then
  KEYSTORE="${LIBO_KEYSTORE:-$HOME/.local/share/libo/release.keystore}"
  ALIAS="${LIBO_KEY_ALIAS:-libo-release}"
  PASSWORD_FILE="$KEYSTORE.password"
  if [ -f "$KEYSTORE" ] && [ -z "${LIBO_KEYSTORE_PASSWORD:-}" ]; then
    : "${LIBO_KEYSTORE_PASSWORD:=$(cat "$PASSWORD_FILE" 2>/dev/null || true)}"
    export LIBO_KEYSTORE_PASSWORD
  fi
  if [ ! -f "$KEYSTORE" ]; then
    mkdir -p "$(dirname "$KEYSTORE")"
    if [ -z "${LIBO_KEYSTORE_PASSWORD:-}" ]; then
      LIBO_KEYSTORE_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)
      printf '%s' "$LIBO_KEYSTORE_PASSWORD" > "$PASSWORD_FILE"
      chmod 600 "$PASSWORD_FILE"
      echo "Generated a random keystore password in $PASSWORD_FILE (chmod 600)."
      echo "Load the keystore and this password into CI secrets; never commit either."
    fi
    export LIBO_KEYSTORE_PASSWORD
    "$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -alias "$ALIAS" \
      -storepass:env LIBO_KEYSTORE_PASSWORD -keypass:env LIBO_KEYSTORE_PASSWORD \
      -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10950 \
      -dname 'CN=LIBO Release, O=LIBO Messenger' -noprompt
    chmod 600 "$KEYSTORE"
  fi
  export LIBO_KEYSTORE_PASSWORD
  PASS_ENV=LIBO_KEYSTORE_PASSWORD
else
  KEYSTORE="${LIBO_KEYSTORE:-$HOME/.local/share/libo/debug.keystore}"
  ALIAS=libo-beta
  export LIBO_DEBUG_PASSWORD="${LIBO_DEBUG_PASSWORD:-android}"
  PASS_ENV=LIBO_DEBUG_PASSWORD
  if [ ! -f "$KEYSTORE" ]; then
    mkdir -p "$(dirname "$KEYSTORE")"
    "$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -alias "$ALIAS" \
      -storepass:env LIBO_DEBUG_PASSWORD -keypass:env LIBO_DEBUG_PASSWORD \
      -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=LIBO Beta,O=LIBO' -noprompt
    chmod 600 "$KEYSTORE"
  fi
fi

APK="$ROOT/artifacts/LIBO-$LIBO_VERSION.apk"
"$JAVA" -jar "$LIBO_TOOLCHAIN/apksigner.jar" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" \
  --ks-pass "env:$PASS_ENV" --key-pass "env:$PASS_ENV" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$APK" "$WORK/aligned.apk"
"$LIBO_TOOLCHAIN/zipalign" -c 4 "$APK"
"$JAVA" -jar "$LIBO_TOOLCHAIN/apksigner.jar" verify --verbose --print-certs "$APK" | tee "$ROOT/artifacts/SIGNING.txt"
"$LIBO_TOOLCHAIN/aapt2" dump badging "$APK" > "$ROOT/artifacts/APK-INFO.txt"
(cd artifacts && sha256sum "LIBO-$LIBO_VERSION.apk" > SHA256SUMS.txt)
echo "Verified $BUILD_TYPE APK: $APK"
