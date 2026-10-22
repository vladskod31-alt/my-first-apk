# LIBO 2.11.4.5 — фактичний стан і план без fake-функцій

Цей документ фіксує відповідність великої специфікації LIBO реальному коду. Позначка
**реалізовано** означає, що функція є в APK і має код/тести. Позначка **не реалізовано**
означає, що кнопки, статуси й рекламні твердження для неї не додаються.

## Архітектурна межа цієї збірки

`2.11.4.5` залишає наявну local-first архітектуру, як було обрано: IndexedDB/WebView +
PeerJS signaling + WebRTC між двома відкритими клієнтами. У repository немає backend БД,
auth/account service, server queue, push gateway, TURN deployment, SFU, payment/entitlement
service, AI provider або audited MLS implementation. Тому server-dependent можливості не
можуть чесно бути позначені як готові.

## Реалізовано у 2.11.4.5

### Повідомлення, надійність і файли

- **1–8, 19–20, 22–25, 27:** багаторядковий composer, reply, forward, edit + локальна
  history до 20 версій, delete-for-both на активному direct channel, pins, reactions,
  локальні `@mentions`, локальний username контакту, пошук chat/media, delivery/read
  receipts і dedupe UUID.
- **13, 17:** local TTL auto-delete та P2P polls до 8 options. UI не називає poll quiz,
  бо quiz mode з відповідями ще не реалізовано.
- **28–36, 40, 43:** local offline queue, persistent outbox у IndexedDB, reconnect,
  ACK, retry after reconnect, idempotent receiver, client-side delivery timing і ручний
  reconnect. Це не server outbox, не idempotent server і не server telemetry.
- **44–64, 66–74, 204–217:** аудіо/музика/voice, MP3/WAV/M4A/AAC/OGG/OPUS/WebM за MIME
  WebView, video MP4/WebM/MOV/MKV, documents, 24 KiB chunk transfer, resume, SHA-256,
  MIME/size/file-ID validation і safe filename/path boundary. Playback/codec support
  залежить від Android WebView; voice/video-to-text не реалізовані.
- **196–197, 199–200, 201, 203:** bounded `libo://` parsing для user/chat/message/file,
  QR профілю та native intent validation. Links не створюють server-side object.
- **223, 224:** локальні reminders та їхні налаштування. Немає push notification нового
  message/mention/call/channel update у фоні.

### Реальні 1:1 дзвінки — пункти 77–90 (частково)

- **77–89:** direct audio/video call використовує `PeerJS MediaConnection` та
  `getUserMedia`; є calling, ringing, connecting, connected, failed, ended, mute,
  camera on/off, remote audio/video та WebRTC diagnostics.
- `Connected` ставиться тільки після `stream` від remote MediaConnection. `Reconnecting`
  відображається лише на реальному `RTCPeerConnection`/ICE `disconnected`; якщо стан стає
  `failed`, виклик завершується. **90** не означає automatic redial — повторне набрання
  користувачем потрібне після terminal failure.
- Це не background calling, телефонна мережа, recording, multi-party call, relay guarantee
  або call history. Потрібні обоє online, дозвіл microphone/camera, підтримуваний WebView та
  ICE route; TURN можна явно налаштувати.

## Не реалізовано й не заявляється

| Група пунктів | Причина |
| --- | --- |
| **9–12, 14–16, 18, 21, 26** | Spoilers, rich formatting, scheduled/silent messages, temporary chats, threads/topics, quiz UI, global search та unread bar потребують окремого UX/protocol або server index. |
| **35, 37–39, 41–42** | Немає server idempotency, server latency/quality telemetry, automatic transport switch чи deployed relay fallback. TURN field — це лише користувацька конфігурація. |
| **91–149** | Channel live, канали, channel chat, memberships, admin roles, permissions/moderation/tags вимагають server-authoritative models і persistent backend. |
| **150–162, 226–250** | Orbix, Premium, paid entitlements і косметика не додані: немає реального server balance, payment/entitlement model. Користувач окремо виключив Orbix/AI з першої фази. |
| **163–186** | MLS, Key Transparency, hybrid X25519 + ML-KEM, encrypted DB/backup, Android Keystore sessions і audited security model не можна безпечно імітувати або писати власноруч як production crypto. Поточний P-256/AES-GCM layer не називається MLS/E2EE audit. |
| **187–195** | Multi-device sessions, remote logout/revocation/key rotation потребують auth/account server. |
| **198, 202, 251–290** | Channel QR/deep-link semantics, Stories та всі AI functions відсутні через відсутність channel/story service та AI provider. |
| **291–305, 325–371** | Розширені theme/community/discover/creator/anti-spam/role features потребують реальних data models, moderation, discovery index та server validation. |
| **372–399** | Частина client cache/lazy media вже є; pagination/virtualization/server cache/priority/background manager і повна device/load/security matrix не завершені. |

## Перевірки 2.11.4.5

- Unit tests перевіряють, що outgoing call не стає `connected` до remote `MediaStream`,
  incoming call чекає реального accept + capture stream, а calls з неузгодженим protocol
  відхиляються.
- Playwright запускає два незалежні клієнти з fake capture devices, встановлює реальний
  local PeerJS WebRTC audio call і перевіряє remote media stream, `Connected`, mute та end.
  Це browser integration test, **не** перевірка physical Android microphone/camera.
- Android shell має `CAMERA`/`RECORD_AUDIO`, але запитує їх лише через WebView permission
  request від локального `appassets.androidplatform.net` origin. Remote origin не отримує
  Native bridge або capture grant.

## Наступні реальні етапи

1. Щоб реалізувати канали/групи/ролі/global search/sessions/anti-spam, потрібен явний
   deployment decision для backend, TLS domain, database, authentication і retention policy.
2. Для reliable calls/live необхідні production TURN credentials; для channel live — SFU,
   bandwidth policy, recording/privacy, moderation і load tests.
3. Для MLS/PQ/hybrid crypto слід обрати audited libraries, провести threat model та
   independent security review до появи слова «encrypted» в UI.
4. Orbix/Premium/AI залишаються вимкненими, поки немає real provider, entitlement/ledger
   policy, rate limits і privacy terms.
