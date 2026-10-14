# Відомі обмеження LIBO 2.9.10.3

Це список реальних меж current P2P/local-first архітектури. Відсутність функції не
позначена як «тимчасово доступна» і не маскується UI-кнопкою.

## 1. Лише 1:1 P2P, без server-side identity

- **Причина:** PeerJS у проєкті — signaling; немає database/auth/API server.
- **Зараз:** особистий `libo-…` peer id, QR та direct WebRTC DataChannel. Profile/username
  надсилаються лише відомому peer під час hello. Username колізія перевіряється тільки
  серед контактів на одному пристрої.
- **Немає:** реєстрації за номером/e-mail, глобального пошуку людей, глобальної
  унікальності username, server-side contacts, presence або account recovery.
- **Напрям:** окремий opt-in backend/federation із чіткою privacy model, не прихована
  «магічна» заміна P2P.

## 2. Немає груп, каналів, topics або live stream

- **Причина:** це потребує membership, moderation, history/fan-out і media infrastructure.
- **Зараз:** базовий poll та reactions працюють між двома peer’ами. `libo://channel/...`
  розпізнається як формат, але чесно повідомляє, що потребує серверної редакції.
- **Немає:** channel QR/join, roles, threaded topics, live audio/video, replay, viewer count
  або anti-spam для спільнот.

## 3. Немає WebRTC дзвінків чи screen sharing

- **Причина:** проєкт використовує DataConnection, не `getUserMedia`/media PeerConnection
  lifecycle з ICE restart, permissions, device switching і call signalling.
- **Зараз:** аудіо/відеофайли — це attachments із `<audio>`/`<video>` playback, не calls.
- **Немає:** audio call, video call, screen share, ringtone, call accept/reject, call quality
  metrics або reconnect UI. Відповідно немає call endpoint/e2e test.

## 4. Немає delivery, коли peer/app закритий

- **Причина:** немає mailbox server, FCM або foreground service.
- **Зараз:** outgoing queue живе локально та повторює dispatch після повернення peer’а;
  browser e2e підтверджує text queue після sender reload. Обидва пристрої мають бути
  доступні для live delivery/file transfer.
- **Немає:** background push, reliable offline server delivery чи multi-device sync.

## 5. Temporary messages не видаляються сервером

- **Причина:** server TTL відсутній.
- **Зараз:** локальні timers у кожного peer’а; довгі TTL re-arm-яться щогодини, а restart
  schedule відновлюється з local history.
- **Ризик:** offline peer не отримує delete одразу; локальна clock manipulation може
  змінити момент видалення. Це не legal/forensic deletion guarantee.

## 6. Streamed files мають перевірений protocol, але не production soak-tested

- **Зараз:** Blob/chunks у IndexedDB, 24 KiB sequential receipts, reconnect resume,
  SHA-256/size ACK, cancel/resume, 100 MiB maximum for audio/music/video/document;
  e2e тестує 1 MiB sender reconnect та unit тестує SHA failure.
- **Не перевірено:** 100 MiB на low-end Android, WebView process kill у середині transfer,
  мобільний NAT/TURN, quota exhaustion, battery/background constraints і multi-hour loss.
- **Codec:** MIME допустимий не гарантує playback. Unsupported codec показує fallback download.

## 7. Android native bridge compiled, але не device-tested

- **Зараз:** APK компілюється з `ACTION_OPEN_DOCUMENT`, `ACTION_CREATE_DOCUMENT` bounded
  save bridge, `libo://` intent filter та `AlarmManager` receiver; Android 13+ permission
  request для notifications є в коді.
- **Не перевірено:** реальний picker vendor ROM, URI permission behavior, exact alarm policy,
  notification delivery/permission, background receiver, restore after reboot та codecs.

## 8. Нагадування локальні

- **Browser:** працюють лише доки page/runtime може виконати timer; notification потребує
  дозволу та доступного browser API.
- **Android:** ставиться local AlarmManager, але device verification ще не проведено.
- **Немає:** server scheduled reminder, sync between devices або гарантія delivery після
  force-stop/Doze policy.

## 9. Локальна база не зашифрована at rest

- **Зараз:** WebRTC DTLS захищає transport; optional MT-style P-256/AES-GCM envelope
  має protocol tests; Android backup вимкнений (`allowBackup=false`).
- **Немає:** незалежного crypto audit, verified E2EE claim, hardware-backed identity,
  encryption of IndexedDB/attachments at rest, secure recovery або key rotation UX.
- **Рекомендація:** не зберігайте секрети, для яких потрібна audited E2EE/at-rest model.

## 10. Профіль/mention/search локальні, bookmarks без folders/tags

- **Зараз:** profile card, known-contact mentions, local search filters і «Збережене»
  функціональні; history of edits локальна на кожній стороні.
- **Немає:** global profile search, server uniqueness, shared contacts, bookmark folders/tags
  або cross-device index. Filter results не можуть показати те, чого немає у local history.

## 11. Polls обмежені P2P 1:1

- **Зараз:** до 8 options, vote та live tally між двома сторонами.
- **Немає:** trustworthy anonymous accounting, multi-answer semantics, quiz correctness UX,
  closing/retention policy, channel/group voting або server anti-fraud. Поля legacy packet
  не слід трактувати як повноцінний server poll service.

## 12. APK signing continuity

- **Зараз:** `downloads/LIBO-2.9.10.3-standalone.apk` має перевірений RSA-4096 v2/v3
  signature та інший package ID `app.libo.messenger.standalone`, тому може стояти поруч із
  legacy app без signature conflict.
- **Ризик:** це окремий застосунок із окремим local storage, а не cryptographically trusted
  in-place update legacy package. Private keystore і password ніколи не потрапляють у Git.

## 13. Gradle/lint та device matrix

- **Зараз:** fallback AAPT2/ECJ/D8 build і APK verification пройшли.
- **Локально:** Gradle wrapper не зміг завантажити Gradle distribution у sandbox
  (`services.gradle.org` SSL EOF). **CI:** GitHub Actions PR #12 успішно виконав Gradle build
  і lint; подробиці в `TESTING.md`.
- **Потрібно перед production:** CI з pinned JDK/SDK, emulator API 26/29/33/35, фізичні
  devices, WebView matrix, TURN/mobile network, accessibility та storage tests.
