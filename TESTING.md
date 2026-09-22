# Проверка LIBO 2.8.3

Дата прогона: 22 сентября 2026. Среда: Linux x64; Node.js 22.22.3; Chromium 143
(пакет `@sparticuz/chromium@143.0.4` из npm, без внешних загрузок браузеров);
OpenJDK Temurin JRE 17.0.17+10 (из npm-пакета `@node-plantuml-2/jre-linux-x64@1.1.8`);
инструменты Android (`aapt2`, `ecj`, `d8`, `apksigner`, `zipalign`, `android.jar` 35) из
внешних зеркал с закреплёнными SHA-256 в `scripts/toolchain-sources.json`. Gradle и SDK
Android в этой среде недоступны (домены загрузок заблокированы), поэтому Gradle-сборка и
lint выполняются в GitHub Actions, а не локально.

## Модульные тесты: 55 из 55 (`npm test`)

### `tests/core.test.mjs` — 30 тестов

1. random peer identities are valid and distinct
2. accepts full contact codes, case and harmless surrounding whitespace
3. rejects partial, URL, HTML, self-invoking or overlong codes
4. names and file names are bounded
5. validates and copies message packets without arbitrary fields
6. rejects invalid packet types and protocol versions
7. message IDs, text, timestamps and limits are mandatory
8. allows bounded raster photos; rejects remote images and SVG
9. replies are copied and bounded
10. ACKs only acknowledge well-formed message IDs
11. hello must identify a LIBO peer, typing must be boolean
12. outgoing serialization excludes local state
13. HTTPS signaling uses the correct host, port and path
14. rejects insecure signaling, embedded secrets and URL injection
15. HTTP only allowed for same-origin local development
16. TURN needs a valid URL and credentials
17. text exports never leak identity, TURN credentials or photo bytes
18. verification code is stable, symmetric and unambiguous
19. verification code depends on both identities
20. 2.5.0 control packets validate and reject malformed input (edit/delete/pin/react)
21. attachments are bounded and mime-checked (voice/video/file, лимиты base64)
22. **2.8.3:** e2ee session seals, rejects replays and tampering, binds identities
23. poll tally and vote merge are pure and bounded
24. 2.8.1 packets: poll message, ttl bounds, forward label, read marker
25. 2.8.2 markup is tokenized, spoilers hidden and markers stripped from previews
26. 2.8.2 schedule presets resolve to absolute local times
27. 2.8.2 night theme window crosses midnight and ignores broken input
28. 2.8.2 polls support quiz answers and multiple choices
29. 2.8.2 silent flag and quoted replies survive validation, schedule stays local
30. **2.8.3:** ships its version, APK link and advertised features (18 пунктов, `2.8.3`)

### `tests/security.test.mjs` — 25 тестов (только слой безопасности)

1. primitives use OS CSPRNG and never repeat random output
2. encryption and decryption roundtrip in both directions
3. key exchange derives the same root without extra packets
4. a third identity cannot join the conversation (MITM)
5. invalid ciphertext and tags are rejected
6. replay of a delivered envelope is refused
7. stale and future timestamps are refused
8. message keys are single use (no nonce or key reuse)
9. out-of-order delivery works, excess skips are refused
10. ratchet rotates the chain after the limit and keeps both sides in sync
11. chain generation outside the allowed range is rejected
12. forward secrecy — old keys cannot decrypt new messages
13. identity change stops the session and reports the new key
14. session states follow the documented transitions and revocation wins
15. brute force protection limits attempts per key
16. malformed and oversized envelopes are refused
17. password storage uses PBKDF2 with per-record salt, never plaintext
18. pairing tokens are single use, expire and keep secrets out of the QR
19. secure logger redacts secrets and stays quiet in release
20. user-facing errors never leak internals
21. fingerprints and key labels are stable and do not reveal the key
22. KDF is deterministic per input and domain-separated
23. identity persists through the vault encoding
24. concurrent sends never reuse a message key or nonce
25. canonical pair id makes asymmetric chat ids interoperable

Тесты 10, 11, 24 и 25 — регрессии на ошибки, найденные при разработке 2.8.3:
расхождение цепочек ratchet после рекея, отсутствие границы поколений, повтор ключа
сообщения при двух одновременных отправках и несовпадение кодов собеседников при
рукопожатии. Соответствие требований и тестов — в `docs/SECURITY_EVIDENCE.md`.

## Браузерные сценарии: 11 из 11 (`npm run test:e2e`)

Playwright + Chromium, файл `tests/app.spec.mjs`, локальный signaling `peer` на том же
порту разработки. Сценарии:

1. **real welcome, no invented contacts, valid QR and version; no open-source claims in UI** —
   пустой старт без вымышленных контактов, личный код формата `LIBO:libo-…`, валидный
   SVG-QR, экран «О LIBO» без упоминаний открытого кода, версия 2.8.3, список из
   восемнадцати возможностей, отсутствие ошибок страницы.
2. **saved messages, literal HTML, drafts, search, theme and reload** — «Избранное»,
   внедрённый `<img onerror>` остаётся текстом и не исполняется, черновики переживают
   перезагрузку, поиск, переключение темы.
3. **mobile navigation, input validation, profile and no horizontal overflow** — экран
   360 px, навигация назад, отклонение некорректного кода контакта, отсутствие
   горизонтальной прокрутки.
4. **text export contains notes but never private contact identity** — скачанный JSON
   содержит заметки, но не личный код профиля и не TURN-пароли.
5. **two independent clients exchange text, delivery ACK, reply and real photo** — два
   изолированных браузерных контекста соединяются по настоящему WebRTC DataChannel через
   локальный signaling: **рукопожатие E2EE X25519 + ChaCha20-Poly1305**, текст, статус
   «доставлено» после сохранения у получателя, ответ, фотография в base64 декодируется в
   `img`, код сверки одинаков на обеих сторонах.
6. **offline queue survives sender reload and is delivered exactly once after reconnect** —
   сообщение, написанное при закрытом получателе, переживает перезагрузку отправителя и
   доставляется ровно один раз после возвращения получателя.
7. **backup import becomes read-only archive and close contacts stay on top** — импорт
   JSON-копии создаёт архив только для чтения с плашкой, звезда поднимает контакт выше
   обычных чатов.
8. **polls, forwarding, read receipts, E2EE layer and secret timer between two clients** —
   опрос с голосованием и живым итогом, пересылка в «Избранное» с пометкой, галочки
   прочтения ✓✓, активная E2EE-сессия (`X25519 + ChaCha20-Poly1305`, состояние
   «Установлено») в диалоге безопасности и исчезновение секретного сообщения по таймеру на
   обоих устройствах.
9. **2.8.2 markup, spoilers, hashtags, quiet mode, scheduling, quiz and media panel** —
   панель «Aa» оборачивает выделенный фрагмент в `**…**`, в пузыре появляется `.rich-bold`,
   спойлер `||…||` скрыт и раскрывается нажатием, `#тег` открывает поиск по тегу, тихое
   сообщение помечено значком, отложенное сообщение показывает чип «Отправлю …» и уходит
   после «Отправить сейчас», квиз красит верный вариант и пишет «Не угадали» при ошибке,
   медиа-панель показывает фотографию и теги, а нажатие на фото переходит к сообщению.
10. **2.8.2 pinned chats and the archive shelf keep the list tidy** — «Закрепить чат»
    поднимает диалог наверх с булавкой, «Отправить в архив» убирает его из основного
    списка, полка архива показывает счётчик и возвращает чат обратно.
11. **2.8.2 unread separator, jump counter, swipe reply and quiet delivery** — сообщения,
    пришедшие в закрытый чат, открываются разделителем «Непрочитанные», при прокрутке
    вверх появляется кнопка вниз со счётчиком, свайп по строке открывает строку ответа,
    тихое сообщение приходит с меткой «без звука», двойной тап оставляет реакцию, и та
    доходит до собеседника — значит, канал жив.

Общее время прогона: около 2,5 минут.

## Проверки APK

- Сборка: `npm run build` → `scripts/build-apk-local.sh` (AAPT2 → ECJ → D8 → zipalign →
  подпись).
- `apksigner verify --verbose --print-certs`: схемы v2 и v3 подтверждены, v1 включена для
  совместимости (minSdk 26 её не требует); сертификат `CN=LIBO Release, O=LIBO Messenger`,
  RSA-4096. Полный вывод сохраняется в `artifacts/SIGNING.txt`.
- `zipalign -c 4` проходит; целостность ZIP и состав APK проверены разбором архива.
- `aapt2 dump badging` (вывод в `artifacts/APK-INFO.txt`): пакет `app.libo.messenger`,
  versionCode **20803**, versionName **2.8.3**, minSdk 26, targetSdk 35, единственное
  разрешение `android.permission.INTERNET`, запускаемая активность
  `app.libo.messenger.MainActivity`, иконка `mipmap-anydpi-v26/ic_launcher.xml` во всех
  плотностях, в assets входят `index.html`, JS/CSS-бандл, шрифты WOFF2, `icon.svg`,
  `icon-192.png`, `icon-512.png` и `third-party-notices.txt`.
- Контрольная сумма APK: `artifacts/SHA256SUMS.txt` и `downloads/SHA256SUMS.txt`
  (значения совпадают) — см. `downloads/SHA256SUMS.txt` и `RELEASE_NOTES.md`.
- Подпись 2.8.3: релизный кейстор владельца в эту среду не передавался, поэтому APK из
  каталога `downloads/` подписан временным тестовым ключом песочницы (RSA-4096, схемы
  v2+v3). Он не совпадает ни с ключом 2.8.0, ни с зеркальными ключами 2.8.1/2.8.2: для
  перехода нужен экспорт копии, удаление прежней версии и импорт. APK из CI (`release.yml`)
  подписывается ключом владельца и ставится поверх без потери истории.
- Новое в 2.8.3: `MainActivity` содержит методы моста `sealLocalSecret`/`openLocalSecret`
  (AES-256-GCM ключом Android Keystore, StrongBox при наличии) — см. «Что не подтверждено».

## Что не подтверждено

- APK не запускался на физическом Android-телефоне и эмуляторе: в среде сборки нет SDK и
  системного образа Android. Проверены подпись, упаковка, состав и содержимое APK, а
  веб-часть проверена браузерными сценариями.
- Работа Android Keystore (`sealLocalSecret`/`openLocalSecret`), StrongBox, `FLAG_SECURE` и
  будущей биометрии проверяется только на устройстве: в песочнице подтверждено лишь то,
  что веб-слой выбирает бэкенд `android-keystore` при наличии моста и что код моста
  компилируется.
- Отложенная отправка проверяется без реального ожидания срока: тест смотрит на чип
  времени и на отправку по кнопке «Отправить сейчас», а абсолютное время пресетов
  покрыто модульными тестами.
- Gradle-сборка и Android lint локально не выполнялись (домены SDK недоступны из этой
  среды); в GitHub Actions они выполняются на каждый push.
- Публичный signaling `0.peerjs.com` и сценарии между разными мобильными операторами не
  тестировались: браузерные сценарии используют локальный signaling и реальные
  WebRTC-каналы на одном хосте.
- Не заявляются: внешний аудит безопасности, нагрузочное тестирование, фоновые
  push-уведомления, серверная аутентификация, Tor-транспорт, автоматическая
  криптографическая проверка личности собеседника.

## Как повторить локально

```sh
npm ci
npm test
npm run test:e2e
npm run build
node scripts/bootstrap-toolchain.mjs   # Linux x64; нужны gh, tar, Node 22
# export JAVA_HOME=<путь из вывода>, LIBO_TOOLCHAIN=<путь из вывода>
./scripts/build-apk-local.sh
python3 scripts/scan-secrets.py
```

Логи: вывод `npm test` и `npm run test:e2e` перечисляет каждую проверку; в GitHub Actions
логи и артефакты прикреплены к прогону workflow; результаты подписи и упаковки APK
сохраняются в `artifacts/SIGNING.txt` и `artifacts/APK-INFO.txt`.
