# Безпека LIBO 2.9.10.3

Цей документ описує фактичну модель захисту тестової P2P-збірки. Незалежного
криптографічного, mobile або penetration audit **не було**. Не використовуйте LIBO для
даних, для яких потрібна audited E2EE, серверна retention policy або гарантоване видалення.

## Модель загроз

| Ризик | Що є | Чого немає / межа |
| --- | --- | --- |
| Пасивне прослуховування P2P каналу | WebRTC DTLS; optional application envelope на ECDH P-256 + AES-256-GCM | Немає незалежного audit або формальної E2EE заяви |
| Replay/tamper у application envelope | монотонні message ids, AES-GCM validation, unit tests tamper/replay | не замінює audited protocol analysis |
| MITM / помилковий peer code | SAS/verification code для пари, QR/full peer code | немає automatic identity verification, public key directory або TOFU key-change warning |
| Вредоносний message/file packet | allowlisted schema, bounded strings/IDs/chunks, MIME/size/index/hash checks, no arbitrary state spread | MIME не є antivirus; user file content не сканується |
| Partial/corrupt streamed file | IndexedDB chunk receipt після commit; complete size + SHA-256 before file ACK | не перевірено на disk quota/process kill/mobile packet loss at 100 MiB |
| XSS у тексті | DOM будується через `textContent`; Playwright перевіряє literal HTML | user все ще має обережно відкривати зовнішні URL/документи |
| Android bridge abuse | WebView завантажує bundled local origin; CSP; external main-frame URL відкривається зовні; bridge input bounded | native paths не тестувалися на фізичних Android ROM |
| Локальна втрата даних | `allowBackup=false`, Android data extraction rules, export excludes peer id/TURN secret/photo bytes | IndexedDB/WebView storage не шифрується окремо at rest |
| Network metadata | можливий own signaling/TURN | public signaling/TURN бачить connection metadata; direct P2P відкриває IP peer’ам |
| Account/device compromise | PIN UI та OS lock можуть приховати UI | PIN не шифрує local database; немає device session list/revocation |

## Transport та crypto: точна заява

1. WebRTC DataChannel має DTLS transport protection.
2. LIBO також має власний **MT-style** packet envelope: ephemeral ECDH P-256, AES-256-GCM,
   SHA-256-derived fields, anti-replay counter та visible pair fingerprint.
3. Node/unit і browser e2e перевіряють negotiation, symmetric fingerprint, tampering і
   replay rejection.
4. Ця схема не є реалізацією Telegram MTProto 2.0 і не проходила незалежного аудиту.
   Тому UI/документація не повинні заявляти «Encrypted/E2EE» як доведену властивість;
   точніше казати «WebRTC DTLS; optional tested-but-unaudited application envelope».
5. Якщо peer стара версія не підтримує envelope/capability, direct transport не слід
   описувати як активний MT layer.

## Вкладення

- Message metadata для new streamed attachment має `fileId`, filename, normalized MIME,
  size, chunk size/count і SHA-256; file Blob не вкладається як giant base64 message.
- Wire chunk максимум 24 KiB binary (base64-encoded лише для DataConnection packet),
  `file-receipt` посилається тільки після persisted chunk.
- Receiver відмовляється від invalid `fileId`, chunk index/size, MIME/category, total size
  та final hash. `Delivered` для файлу залежить від success `file-ack` після reassembly.
- Ліміти: image 12 MiB; voice 5 MiB / 60 s; audio/music/video/document 100 MiB. Вони
  клієнтські/protocol limits, не server quotas.
- Схвалення MIME не робить файл безпечним. Завантажені документи відкривайте на власний
  ризик; LIBO не має antivirus/sandbox document viewer.

## Android WebView і native bridge

- Локальний origin: `https://appassets.androidplatform.net`; file URL access вимкнено,
  mixed content вимкнено, CSP `default-src 'self'` з media/blob allowance.
- `LiboAndroid` надає лише bounded copy/share/text export, native save chunks, reminder,
  theme callbacks; remote main-frame navigation відкривається у зовнішньому browser.
- `ACTION_OPEN_DOCUMENT` повертає тільки user-selected content URI. Збереження через
  `ACTION_CREATE_DOCUMENT` пише small bridge chunks з JS backpressure і native byte counter
  звіряє exact declared Blob size; Blob не передається як `file://` URL.
- `libo://` приймає лише strict host/path без query/fragment у Java і повторно
  валідовується у JS. Channel links не виконують серверну дію.
- Ці твердження compile-reviewed; device/ROM behavior ще не тестовано.

## APK 2.9.10.3

```text
Package: app.libo.messenger.standalone
Label: LIBO Standalone
Version: 2.9.10.3 (2091003)
Signer DN: CN=LIBO Release, O=LIBO Messenger
Signer certificate SHA-256: a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910
APK schemes verified: v2, v3
```

Перевірка:

```sh
sha256sum -c downloads/SHA256SUMS.txt
apksigner verify --verbose --print-certs downloads/LIBO-2.9.10.3-standalone.apk
```

Ключ/пароль не лежать у repository. Цей sandbox-generated signer не слід вважати тим самим
ключем попередніх release без ручного certificate comparison; див. `RELEASE_NOTES.md`.

## Повідомлення про вразливість

Не публікуйте exploit/secret у відкритому issue. Скористайтеся приватним GitHub security
reporting для repository (якщо ввімкнено) або зверніться до його власника приватно. Додайте:

- exact version/tag та APK SHA-256;
- Android/browser/WebView версію;
- мінімальні відтворювані кроки;
- уражений компонент (`web/`, transport, attachment, Android bridge);
- impact і, за можливості, безпечний proof of concept.

Не надсилайте власні keys, історію повідомлень, TURN credential або повні приватні backups.
