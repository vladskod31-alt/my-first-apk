# Перевірка LIBO 2.11.4.5

Дата локальної перевірки: **14 жовтня 2026**. Це evidence для конкретного
`app.libo.messenger.standalone` APK, а не твердження про production service або всі пункти
майбутньої roadmap.

## Виконані перевірки

| Команда / перевірка | Результат |
| --- | --- |
| `npm test` | **33/33 passed** |
| `npm run build` | passed (Vite production bundle) |
| `npm run test:e2e` | **12/12 passed** |
| fallback AAPT2/ECJ/D8 build | passed; 11 pre-existing Android deprecation warnings |
| `zipalign -c 4` | passed |
| `apksigner verify --verbose --print-certs` | v2 + v3 passed |
| `aapt2 dump badging` | package/version/permissions below confirmed |
| `sha256sum -c downloads/SHA256SUMS.txt` | all listed APK files passed |

## Що покривають тести

### Unit tests

- P2P message validation, bounded text/mentions/profiles/deep links, MT session replay/tamper
  rejection, attachment MIME/limits, chunk encoding/SHA-256 and transfer resume/ACK.
- `calls.test.mjs`: outgoing call має тільки `calling` до приходу remote `MediaStream`; incoming
  call лишається `ringing` до explicit accept + capture stream; MediaConnection з невірним
  protocol відхиляється без UI state.

### Browser integration

Playwright створює два незалежні клієнти та проходить text/ACK/read/reply/edit/delete/reaction,
offline queue/reconnect, profiles/mentions/links, polls, TTL, chunked file resume і current
call flow. Для audio call тесту Chromium запускається з fake capture devices:

1. Alice/Bob підключаються через local PeerJS.
2. Alice стартує audio call, Bob бачить real incoming MediaConnection і explicit accept.
3. Обидва клієнти чекають `Connected` **лише після** remote `MediaStream`.
4. Тест перевіряє remote audio `srcObject`, mute та end.

Це реальний локальний WebRTC integration test, але fake device != фізичний Android microphone,
camera, WebView або mobile NAT.

## APK metadata

```text
package: name='app.libo.messenger.standalone'
versionCode='2110405'
versionName='2.11.4.5'
minSdkVersion:'26'
targetSdkVersion:'35'
application-label:'LIBO Standalone'
uses-permission: android.permission.INTERNET
uses-permission: android.permission.RECORD_AUDIO
uses-permission: android.permission.CAMERA
uses-permission: android.permission.POST_NOTIFICATIONS
```

APK: `downloads/LIBO-2.11.4.5-standalone.apk`, **313,723 B**,
SHA-256 `1f123853534ec28c484772dc1daf3555114b6c50659577dad3035093e0c8a40b`.

Signer certificate SHA-256:

```text
a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910
```

`apksigner` reported v2/v3 `true`; v1/v3.1/v4 are not used. `zipalign -c 4` passed.

## Android compile and permission review

The fallback toolchain compiled `MainActivity.java` and `ReminderReceiver.java` successfully.
The 11 compiler warnings are Android deprecated compatibility/system-bar APIs that predate the
call implementation; no compile error occurred.

`MainActivity` accepts a WebView `PermissionRequest` only from
`https://appassets.androidplatform.net`, only for audio/video capture, and only after matching
Android runtime `RECORD_AUDIO`/`CAMERA` permission. Any other resource or origin is denied.

## Still not device-verified / not claimed

- APK was not installed on a physical Android phone or emulator in this environment. Android
  runtime permission UX, camera/microphone capture, backgrounding and long calls need device
  tests on API 26/29/33/35.
- TURN/mobile NAT/VPN route, call reconnection behavior and real codec/device matrix are not
  verified. A configured TURN endpoint is required on restrictive networks.
- Channel/group/live/SFU/roles/server sessions/global search/Orbix/Premium/AI/MLS/ML-KEM are
  not implemented in this P2P build; see `ROADMAP_2.11.4.5.md`.
- No independent security audit, penetration test, load test, production TURN, push or
  foreground-call service was performed.

## CI

GitHub Actions on the pull request runs Gradle build/lint, the Node + browser suite, and a
Git-history secret audit. Local Gradle wrapper cannot download Gradle in this sandbox because
`services.gradle.org` returns an SSL EOF; the local fallback build above is used instead.
