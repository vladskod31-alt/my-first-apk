# LIBO 2.9.10.3

![Іконка LIBO](web/public/icon-512.png)

**LIBO — local-first особистий месенджер 1:1.** Відкриті одночасно пристрої з’єднуються
безпосередньо через WebRTC DataChannel; PeerJS використовується лише для сигналізації.
Історія, чернетки, профілі відомих контактів, нагадування та вкладення зберігаються
локально у IndexedDB/WebView. У проєкті **немає** сервера історії, облікових записів,
каталогу користувачів або фонової доставки.

Поточна версія: **2.9.10.3 Standalone** · Android 8.0+ (API 26+) · пакет
`app.libo.messenger.standalone` · `versionCode 2091003`. Це окремий Android package,
тому він встановлюється поруч із legacy `app.libo.messenger` без signature conflict.

> Це тестова P2P-збірка. Не називайте її серверним месенджером, E2EE-аудованим продуктом,
> каналами, live stream або дзвінками: цих функцій у цій редакції немає.

## APK

Після публікації тега [`v2.9.10.3`](https://github.com/vladskod31-alt/my-first-apk/tree/v2.9.10.3)
основний файл лежить у його каталозі `downloads/`:

- [LIBO-2.9.10.3-standalone.apk](https://github.com/vladskod31-alt/my-first-apk/raw/refs/tags/v2.9.10.3/downloads/LIBO-2.9.10.3-standalone.apk)
- [SHA256SUMS.txt](https://github.com/vladskod31-alt/my-first-apk/raw/refs/tags/v2.9.10.3/downloads/SHA256SUMS.txt)

Точний SHA-256, сертифікат збірки та порядок інсталяції описані в
[RELEASE_NOTES.md](RELEASE_NOTES.md). Це **не in-place update** legacy пакета: Standalone
має власні local history/IndexedDB і може стояти поруч зі старим LIBO. За потреби
експортуйте стару текстову копію та імпортуйте її вручну в новий застосунок.

## Що справді реалізовано в 2.9.10.3

### Повідомлення та стан доставки

- Багаторядковий `textarea`: **Enter** додає рядок; відправлення — кнопкою або
  **Ctrl/Cmd+Enter**. Висота зростає до 180 px, потім з’являється вертикальна прокрутка;
  довгі URL, `@username` і emoji переносяться, а не стають вертикальним текстом.
- Локально збережені UUID повідомлень, черга після втрати зв’язку та дедуплікація на
  отримувачі. Текстове повідомлення не чекає завершення великого file transfer.
- Чесні стани: **LOCAL** — лише «Збережене»; **QUEUED** — немає відкритого P2P-каналу;
  **SENT** — envelope передано DataChannel; **DELIVERED** — метадані збережені отримувачем
  (для streamed-файлу — тільки після складання та SHA-256); **READ** — прийшов read receipt;
  **FAILED** — локальна/протокольна помилка. В інтерфейсі є debug-розклад останньої доставки
  (черга, доставка, ACK, read), але це клієнтські часові мітки, не серверна телеметрія.
- Відповіді, реакції, закріплення, редагування, delete-for-both, пересилання, «Збережене»,
  локальна історія редагувань до 20 попередніх версій та локальні нагадування.

### Вкладення без monolithic Base64

Нові вкладення передають у повідомленні лише перевірені метадані: `fileId`, MIME, ім’я,
розмір, кількість чанків та SHA-256. Оригінальний Blob і прийняті шматки зберігаються
окремо у IndexedDB. Дані проходять послідовними чанками по **24 KiB**, кожен прийнятий
chunk підтверджується тільки після запису до IndexedDB. Після reconnect отримувач повертає
наступний contiguous chunk, а передавач продовжує з нього. Остаточний `Delivered` для файлу
вимагає повного розміру та SHA-256 ACK; є скасування й ручне відновлення.

| Вид | Реальний ліміт | Примітка |
| --- | ---: | --- |
| Фото JPG / PNG / WebP | 12 MiB до обробки | Фото з кнопки стискається до JPEG максимум 1600 px; файл зберігається як новий JPEG. |
| Голосове | 5 MiB, 60 с | Формат визначає `MediaRecorder` браузера/WebView. |
| Аудіо / музика | 100 MiB | Оригінальний Blob не перекодовується. |
| Відео | 100 MiB | MP4, WebM, MOV, MKV у file picker; відтворення залежить від codec WebView. |
| Документ / інший дозволений MIME | 100 MiB | Зберігається й завантажується в оригінальному форматі. |

Для музики читаються ID3v2.3/v2.4 поля title/artist/album і компактна JPEG/PNG/WebP
обкладинка до 200 KiB; якщо тега немає, назва — ім’я файла. `<audio>`/`<video>` отримують
Blob URL та metadata duration; коли конкретний codec не декодується, UI показує чесний
fallback «зберегти оригінал», а не імітацію плеєра.

### Профіль, пошук, посилання

- Профіль 2.0: ім’я, `@username` (`[a-z][a-z0-9_]{2,31}`), bio до 160 символів, статус та
  компактний JPEG/PNG/WebP avatar. Профіль надсилається лише напряму під час P2P hello.
  Унікальність username **лише локальна серед відомих контактів**; глобального каталогу
  або server-side uniqueness немає.
- `@mentions` мають автодоповнення відомих контактів, зберігають peer id і відкривають
  профіль. У розмові 1:1 згадка про себе відкриває власну read-only profile card.
- Локальний пошук у чаті й у списку чатів розуміє `from:@username`, `in:`, `audio:`,
  `video:`, `file:`, `has:link`, `has:media`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD`.
  Результати обмежені тим, що вже є на цьому пристрої.
- QR-запрошення та перевірені `libo://user/<peer-id>`, `chat`, `message`, `file`. Спроба
  відкрити `libo://channel/...` чесно повідомляє, що для нього потрібна серверна редакція.

### Android shell

WebView використовує локальний origin `appassets.androidplatform.net`, CSP і обмежений
міст `LiboAndroid`. Він дає системний `ACTION_OPEN_DOCUMENT` для загального file picker,
`ACTION_CREATE_DOCUMENT` для збереження Blob із bounded Base64 bridge chunks та
backpressure, обробку `libo://` intent і локальні `AlarmManager` reminders. На Android 13+
програма запитує `POST_NOTIFICATIONS` тільки коли створюється нагадування.

Ці шляхи **скомпільовані в APK**, але не запускалися на фізичному Android-пристрої в цьому
середовищі; див. [TESTING.md](TESTING.md).

## Відомі межі

- Немає WebRTC audio/video calls, screen sharing, груп, каналів, live stream, серверних
  topics, anti-spam, сесій/пристроїв, серверного TTL або delivery while the app is closed.
- Тимчасові повідомлення видаляються локальними таймерами обох peer’ів; це не
  серверно-примусове видалення. Офлайн-пристрій не може отримати наказ негайно.
- Опитування — базові P2P 1:1 до 8 варіантів; немає server-side anonymous/quiz accounting,
  глобального закриття або channel polls.
- WebRTC захищає транспорт DTLS. Додатковий експериментальний MT-style envelope
  (ECDH P-256 + AES-256-GCM) має unit/e2e-перевірки, але не має незалежного аудиту;
  локальна IndexedDB не зашифрована окремо. Тому не робиться маркетингова заява про
  «перевірене E2EE».

Повний список — [KNOWN_ISSUES.md](KNOWN_ISSUES.md), модель загроз — [SECURITY.md](SECURITY.md).

## Розробка й перевірка

```sh
npm ci
npm test           # 30 node:test перевірок
npm run test:e2e   # 11 Playwright/WebRTC сценаріїв
npm run build      # Vite production bundle у dist/

# Linux x64 fallback, коли Android SDK/Gradle недоступні:
node scripts/bootstrap-toolchain.mjs
# export JAVA_HOME=...; export LIBO_TOOLCHAIN=...
./scripts/build-apk-local.sh
```

`./gradlew` потребує встановленого JDK/SDK Android. Детальні фактичні результати,
включно з exact APK hash та неперевіреними ділянками, — у [TESTING.md](TESTING.md).

## Структура

| Шлях | Призначення |
| --- | --- |
| `web/` | Web UI, P2P протокол, IndexedDB та transfer manager |
| `app/` | Android WebView shell, native bridge, deep links, reminders |
| `tests/` | node:test та Playwright сценарії |
| `scripts/` | локальний signaling server, pinned fallback toolchain, APK build |
| `downloads/` | невелике дзеркало APK для tagged release |

Документація: [RELEASE_NOTES.md](RELEASE_NOTES.md), [TESTING.md](TESTING.md),
[KNOWN_ISSUES.md](KNOWN_ISSUES.md), [SECURITY.md](SECURITY.md),
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).
