# LIBO 2.9.10.3 — тестовий Android/P2P release

**Дата збірки:** 14 жовтня 2026 · **package:** `app.libo.messenger.standalone` ·
**label:** `LIBO Standalone` · **мінімум:** Android 8.0 / API 26 · **target/compile SDK:**
35 · **versionCode:** `2091003` · **versionName:** `2.9.10.3`.

Це не серверний запуск LIBO. Це local-first 1:1 P2P build: PeerJS сигналізує з’єднання,
а повідомлення та file chunks ідуть WebRTC DataChannel, коли обидва пристрої доступні.

## Завантаження та перевірка

| Файл | Розмір | SHA-256 |
| --- | ---: | --- |
| `downloads/LIBO-2.9.10.3-standalone.apk` | 305,531 B (≈299 KiB) | `8b79151ed87efe4adde6b0269e14b83c175479b4af61af4fa6d8e05e01b08226` |

Після створення тега `v2.9.10.3` використовуйте:

```sh
curl -fL -O https://github.com/vladskod31-alt/my-first-apk/raw/refs/tags/v2.9.10.3/downloads/LIBO-2.9.10.3-standalone.apk
curl -fL -O https://github.com/vladskod31-alt/my-first-apk/raw/refs/tags/v2.9.10.3/downloads/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt
# macOS: shasum -a 256 LIBO-2.9.10.3-standalone.apk
# PowerShell: (Get-FileHash .\LIBO-2.9.10.3-standalone.apk -Algorithm SHA256).Hash
```

## Підпис та оновлення — важливо

APK цієї збірки підписано в Arena fallback toolchain згенерованим RSA-4096 ключем:

```text
Signer #1 certificate DN: CN=LIBO Release, O=LIBO Messenger
Signer #1 certificate SHA-256 digest: a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910
APK Signature Schemes: v2 + v3 verified
```

Ключ не доданий до Git і не є підтвердженим продовженням ключа попереднього 2.8.1 APK.
Замість небезпечної спроби оновлення з іншим signer цей файл має **новий package ID**
`app.libo.messenger.standalone`. Тому Android встановлює його поруч із legacy
`app.libo.messenger` і не показує помилку «пакет конфліктує з наявним пакетом».

1. Встановіть `LIBO-2.9.10.3-standalone.apk` — видаляти старий LIBO не потрібно.
2. На launcher з’явиться окремий ярлик **LIBO Standalone**.
3. Дані двох package ізольовані. Якщо потрібна стара історія, у старому застосунку зробіть
   «Експорт тексту», а в Standalone імпортуйте копію як read-only archive.

Перевірити підпис самостійно:

```sh
apksigner verify --verbose --print-certs LIBO-2.9.10.3-standalone.apk
```

## Що змінилося

### 1. Великі вкладення та медіа

- Новий persistent stream protocol: metadata у message, Blob/chunks окремо в IndexedDB;
  chunk 24 KiB, receipt лише після durable write, resume з contiguous chunk після reconnect,
  SHA-256 та size verification перед file ACK.
- Аудіо, музика, відео й файли до 100 MiB; фото до 12 MiB до локального JPEG compression;
  voice до 5 MiB / 60 секунд.
- Реальні `<audio>` і `<video>` з Blob URL, duration metadata, download fallback для
  unsupported codec. Музика читає ID3v2.3/v2.4 title/artist/album/маленьку обкладинку,
  або чесно показує filename.
- Загальний Android picker, native streaming save через `ACTION_CREATE_DOCUMENT`, скасування
  та ручне відновлення transfer. У wire message немає giant Base64 file payload.

### 2. Composer, офлайн-стійкість і message lifecycle

- Multi-line composer без vertical text: Enter = newline; Ctrl/Cmd+Enter або кнопка = send;
  auto-grow до 180 px та `overflow-wrap:anywhere` для довгих URL/@username/emoji.
- UUID/idempotence, offline queue, ack/read receipt, client-side latency debug. Текст
  dispatch-иться незалежно від chunk transfer.
- `Delivered` для streamed attachment з’являється лише після receiver reassembly,
  SHA-256 verification і `file-ack`; `Read` — лише після фактичного read packet.
- Чернетки тексту/reply/attachment metadata, локальна історія правок до 20 версій,
  reply/forward/reaction/pin/save/delete/reminder.

### 3. Profile 2.0 та навігація

- Ім’я, локально-унікальний серед відомих контактів `@username`, bio, статус, avatar,
  direct-profile exchange, mention autocomplete та profile cards.
- Local search filters: `from:@username`, `in:`, `audio:`, `video:`, `file:`, `has:link`,
  `has:media`, `before:`, `after:`. Це не server/global search.
- QR user invite і strict `libo://user`, `chat`, `message`, `file`; Android VIEW intent для
  `libo://`. `channel` deep link валідно розпізнається, але чесно відхиляється як функція,
  що потребує server-backed редакції.
- Browser/local reminder; Android AlarmManager receiver та notification permission flow
  зібрані у APK.

### 4. Security hardening

- Обмежені packet schemas, MIME/size/chunk-index/hash validation, filename sanitation,
  bounded bridge chunks, CSP локального Android WebView, deep-link validation.
- Додатковий MT-style P-256/AES-GCM envelope поверх WebRTC DTLS з replay checks і pair
  fingerprint збережено, але **не має незалежного криптоаудиту**. Не трактуйте це як
  маркетингово верифікований E2EE claim.

## Чого release не додає

Ці пункти навмисно не позначені як готові: WebRTC calls, video calls, screen sharing,
канали, live stream, server-side topics/anti-spam/TTL/sessions/devices, телефонна
реєстрація, глобальний username search, server-enforced temporary chat deletion, push і
message delivery коли peer/app закриті. Базові P2P polls залишаються 1:1; повноцінні
anonymous/quiz/close semantics потребують окремої серверної моделі.

## Установка

1. Перевірте SHA-256 й підпис.
2. Дозвольте установку з браузера/файлового менеджера в Android Settings, якщо система
   попросить.
3. Відкрийте LIBO на обох пристроях, обміняйтеся QR або повним `LIBO:libo-…` кодом.
4. Порівняйте code verification через меню чату по надійному каналу перед обговоренням
   чутливих даних.
5. Для P2P NAT, де прямий WebRTC не встановлюється, налаштуйте власний TURN за
   [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Результат перевірок

На 14.10.2026 у Linux x64 пройшли `npm test` (30/30), `npm run build` та браузерні
Playwright/WebRTC сценарії (11/11). Fallback APK пройшов ECJ/D8/AAPT2/zipalign та
`apksigner verify` (v2/v3). Після push GitHub Actions PR #12 також успішно пройшов Gradle
build/lint, module/browser tests і secret audit. Локальний `./gradlew` у sandbox не міг
завантажити wrapper distribution; фізичний Android і Android emulator не запускалися.
Повна матриця, exact commands, обмеження та результати — [TESTING.md](TESTING.md).
