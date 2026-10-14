# Перевірка LIBO 2.9.10.3

**Дата:** 14 жовтня 2026 · **середовище:** Linux x64, Node.js 22, Playwright Chromium,
Temurin JRE 17.0.17+10. Це фактичний звіт, а не список запланованих перевірок.

## Пройдено

| Команда / перевірка | Результат | Що саме підтверджує |
| --- | --- | --- |
| `npm test` | **30 / 30 passed** | packet schemas, crypto envelope, hash/base64, streamed files, resume position, SHA-256 reject, profile/deep-link bounds |
| `npm run build` | **passed** | Vite production bundle (`42 modules`) |
| `npm run test:e2e` | **11 / 11 passed** | UI, real local PeerJS + WebRTC DataChannel, offline text queue, multi-chunk files, sender reconnect/resume |
| `./scripts/build-apk-local.sh` | **passed** | AAPT2 → ECJ → D8 → zipalign → apksigner; release APK generated |
| GitHub Actions PR #12: Gradle build + lint | **passed (1m31s)** | canonical Gradle/Android lint on CI after push |
| `zipalign -c 4` / `apksigner verify --verbose --print-certs` | **passed** | APK alignment and v2/v3 signature |
| `aapt2 dump badging` | **passed** | package/version/minSdk/permissions in generated APK |

## Node/unit tests — 30/30

`node --test tests/*.test.mjs` виконує `tests/core.test.mjs` та
`tests/attachments.test.mjs`.

Окремо нове для 2.9.10.3:

1. metadata-only streamed attachment приймається лише з valid file id, MIME, size,
   chunk count та SHA-256; oversized chunk/hash/limit відхиляються;
2. `file-chunk`, receipt, state, ACK, username, profile, mention і strict `libo://`
   packet validation;
3. binary base64 round trip та deterministic SHA-256 Blob;
4. outgoing resume: peer повідомляє `next=1`, передавач надсилає тільки chunks 1 і 2,
   а state стає `delivered` лише після `file-ack`;
5. incoming chunks зберігаються, збираються, перевіряються SHA-256 та ACK-аються тільки
   після success;
6. навмисно неправильний final SHA-256 дає `failed` + negative `file-ack`, не Delivered.

Існуючі 2.x перевірки також пройшли: identity/code bounds, XSS/literal message content,
MIME/attachment guards, signaling/TURN validation, export privacy, SAS, packet controls,
P-256/AES-GCM/replay checks, polls, TTL/read marker.

## Browser / WebRTC — 11/11

`npm run test:e2e` запускає локальний signaling server та Playwright сценарії з
ізольованими browser contexts. Це справжні WebRTC DataConnection між двома сторінками на
цьому host, не mock transport.

1. чистий старт, QR, version/about і відсутність помилок сторінки;
2. Saved, literal HTML (не виконується), draft/reload, basic search/theme;
3. mobile 360 px, validation і відсутність horizontal overflow;
4. text export не містить identity/TURN secret;
5. два endpoint-и: text, receiver ACK, reply, image, reaction, pin, edit/delete, history
   of edits і **70 KiB file через кілька 24 KiB chunks**. Sender `delivered` очікується
   тільки після receiver verified file ACK;
6. text offline queue переживає reload та доставляється рівно один раз;
7. read-only archive import і близькі контакти;
8. базовий P2P poll, forwarding, read receipt, MT-style session і TTL;
9. multiline composer з long URL/@mention/emoji, music draft/card без Base64 payload UI;
10. profile exchange, local username, mention/profile navigation, validated `libo://user`
    і local `from:@… has:link` filter;
11. **actual sender reconnect під час 1 MiB chunked transfer**: тест бачить `Передача`,
    перезапускає sender transport, потім очікує `Получено и проверено` на peer і
    `delivered` на sender. Цей сценарій перевіряє resume поверх реального локального
    WebRTC endpoint.

Ці тести не вимірюють мобільну мережу. Локальні timings у security dialog показують
клієнтські мітки черги/доставки/ACK/read; вони не є latency SLA.

## GitHub Actions result

Після push commit `ffb54d5` усі checks PR [#12](https://github.com/vladskod31-alt/my-first-apk/pull/12)
пройшли у run [38564219042](https://github.com/vladskod31-alt/my-first-apk/actions/runs/38564219042):

- **Gradle build and lint** — passed, 1m31s;
- **module + browser tests** — passed, 1m54s;
- **Git-history secret audit** — passed, 7s.

Це доповнює локальний fallback compile; CI не замінює тест на фізичному телефоні.

## APK

Для sandbox без Android SDK застосовано pinned fallback toolchain із
`scripts/toolchain-sources.json`: android.jar API 35, AAPT2, ECJ, D8, apksigner і zipalign
мають перевірені хеші; JRE 17 завантажено окремо поза репозиторієм.

Фактичний результат `aapt2 dump badging` для 2.9.10.3:

```text
package: name='app.libo.messenger.standalone' versionCode='2091003' versionName='2.9.10.3'
minSdkVersion:'26'
targetSdkVersion:'35'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.POST_NOTIFICATIONS'
launchable-activity: app.libo.messenger.MainActivity
```

`apksigner` підтвердив v2 і v3 та один RSA-4096 signer:

```text
CN=LIBO Release, O=LIBO Messenger
certificate SHA-256: a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910
```

APK: `LIBO-2.9.10.3-standalone.apk`, **305,531 B**, SHA-256
`8b79151ed87efe4adde6b0269e14b83c175479b4af61af4fa6d8e05e01b08226`. Він має package
`app.libo.messenger.standalone`, тому встановлюється поруч із legacy package без conflict.
Команда build кладе той самий хеш у `artifacts/SHA256SUMS.txt`; release mirror — у
`downloads/SHA256SUMS.txt`.

### Android compile warnings

ECJ успішно зібрав `MainActivity.java` і `ReminderReceiver.java`. Є лише warnings про
Android deprecated API compatibility calls (`setAllowFileAccessFromFileURLs`, system bar
API та pre-O `Notification.Builder`); compile error немає.

## Що не перевірено / не заявляється

- Локальний `./gradlew assembleDebug` у sandbox не дійшов до build, бо wrapper не зміг
  завантажити `gradle-8.9-bin.zip` із `services.gradle.org` (SSL EOF). GitHub Actions
  Gradle build/lint пройшов; це не замінює device test.
- APK не встановлювався на фізичний Android або emulator. Тому `ACTION_OPEN_DOCUMENT`,
  `ACTION_CREATE_DOCUMENT` streaming save, Android `AlarmManager`, POST_NOTIFICATIONS,
  intent-dispatch і media codec behavior compiled/inspected, але **не device-verified**.
- Відновлення transfer перевірене в unit simulation і локальному two-browser reconnect;
  не перевірено на мобільному NAT, kill/restart WebView під час transfer чи 100 MiB файл.
- Реальні audio/video call endpoint-и, live stream, channels, server topics/anti-spam/
  sessions, global account/username search і server TTL не існують у цій архітектурі, тому
  для них немає «passed» тесту.
- Незалежний security audit, penetration/load test, production TURN і foreground/push
  delivery не виконувалися.

## Як повторити

```sh
npm ci
npm test
npm run build
npm run test:e2e

node scripts/bootstrap-toolchain.mjs
export JAVA_HOME='<значення з виводу>'
export LIBO_TOOLCHAIN='<значення з виводу>'
./scripts/build-apk-local.sh

# якщо є встановлені JDK/SDK і доступ до Gradle/Maven:
./gradlew assembleDebug
```

Перевіряти Android APK треба також на API 26, 29, 33 і 35: picker/save, дозвіл
notifications, deep link, large audio/video, interrupt/resume, low-storage та codec fallback.
