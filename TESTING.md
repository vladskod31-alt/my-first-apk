# Проверка LIBO 2.8.2

Дата прогона: 22 сентября 2026. Среда: Linux x64; Node.js 22.22.3; Chromium 143
(пакет `@sparticuz/chromium@143.0.4` из npm, без внешних загрузок браузеров);
OpenJDK Temurin JRE 17.0.17+10 (из npm-пакета `@node-plantuml-2/jre-linux-x64@1.1.8`);
инструменты Android (`aapt2`, `ecj`, `d8`, `apksigner`, `zipalign`, `android.jar` 35) из
внешних зеркал с закреплёнными SHA-256 в `scripts/toolchain-sources.json`. Gradle и SDK
Android в этой среде недоступны (домены загрузок заблокированы), поэтому Gradle-сборка и
lint выполняются в GitHub Actions, а не локально.

## Модульные тесты: 30 из 30 (`npm test`)

Фреймворк `node:test`, файлы `tests/core.test.mjs`. Названия проверок:

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
22. mt session seals, rejects replays and tampering, shares fingerprint
23. poll tally and vote merge are pure and bounded
24. 2.8.0–2.8.1 packets: poll message, ttl bounds, forward label, read marker
25. 2.8.2 markup is tokenized, spoilers hidden and markers stripped from previews
26. 2.8.2 schedule presets resolve to absolute local times
27. 2.8.2 night theme window crosses midnight and ignores broken input
28. 2.8.2 polls support quiz answers and multiple choices
29. 2.8.2 silent flag and quoted replies survive validation, schedule stays local
30. 2.8.2 ships version 2.8.2, its APK link and fourteen advertised features

Проверки 25–30 новые: разбор разметки (`**жирный**`, `_курсив_`, `__подчёркнутый__`,
`~~зачёркнутый~~`, `` `моно` ``, `||спойлер||`) и очистка превью, абсолютное время для
пяти пресетов отложенной отправки, ночное окно 22:00 → 07:00 с переходом через полночь,
квиз с правильным ответом и опрос с несколькими ответами (в том числе массив в
`pollvote`), флаг `silent` и цитата в ответе, а также отсутствие `scheduledAt` в пакете,
который уходит собеседнику.

## Браузерные сценарии: 11 из 11 (`npm run test:e2e`)

Playwright + Chromium, файл `tests/app.spec.mjs`, локальный signaling `peer` на том же
порту разработки. Сценарии:

1. **real welcome, no invented contacts, valid QR and version; no open-source claims in UI** —
   пустой старт без вымышленных контактов, личный код формата `LIBO:libo-…`, валидный
   SVG-QR, экран «О LIBO» без упоминаний открытого кода, версия 2.8.2, список из
   четырнадцати возможностей, отсутствие ошибок страницы.
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
   локальный signaling: текст, статус «доставлено» после сохранения у получателя, ответ,
   фотография в base64 декодируется в `img`, код сверки одинаков на обеих сторонах.
6. **offline queue survives sender reload and is delivered exactly once after reconnect** —
   сообщение, написанное при закрытом получателе, переживает перезагрузку отправителя и
   доставляется ровно один раз после возвращения получателя.
7. **backup import becomes read-only archive and close contacts stay on top** — импорт
   JSON-копии создаёт архив только для чтения с плашкой, звезда поднимает контакт выше
   обычных чатов.
8. **polls, forwarding, read receipts, MT layer and secret timer between two clients** —
   опрос с голосованием и живым итогом, пересылка в «Избранное» с пометкой, галочки
   прочтения ✓✓, активный MT-слой AES-256-GCM в диалоге безопасности и исчезновение
   секретного сообщения по таймеру на обоих устройствах.
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

## Проверки APK

- Сборка: `npm run build` → `scripts/build-apk-local.sh` (AAPT2 → ECJ → D8 → zipalign →
  подпись).
- `apksigner verify --verbose --print-certs`: схемы v2 и v3 подтверждены, v1 включена для
  совместимости (minSdk 26 её не требует); сертификат `CN=LIBO Release, O=LIBO Messenger`,
  RSA-4096; SHA-256 сертификата
  `d6bc33ca85e16d1365fa7bea1d56fd1497ca48ed54390dd897bc08136457678e`. Полный вывод
  сохраняется в `artifacts/SIGNING.txt`.
- `zipalign -c 4` проходит; целостность ZIP и состав APK проверены разбором архива.
- `aapt2 dump badging` (вывод в `artifacts/APK-INFO.txt`): пакет `app.libo.messenger`,
  versionCode 20802, versionName 2.8.2, minSdk 26, targetSdk 35, единственное разрешение
  `android.permission.INTERNET`, запускаемая активность `app.libo.messenger.MainActivity`,
  иконка `mipmap-anydpi-v26/ic_launcher.xml` во всех плотностях, в assets входят
  `index.html`, JS/CSS-бандл, шрифты WOFF2, `icon.svg`, `icon-192.png`, `icon-512.png` и
  `third-party-notices.txt`.
- Контрольная сумма APK: `artifacts/SHA256SUMS.txt` и `downloads/SHA256SUMS.txt`
  (значения совпадают):
  `594a2dbc5814baebc2152929283b7f2eb1761423960bc63da28209e56cb4c279`.
- Подпись 2.8.2: релизный кейстор владельца в эту среду не передавался, поэтому APK из
  каталога `downloads/` подписан временным тестовым ключом песочницы (RSA-4096, схемы
  v2+v3, отпечаток выше). Он не совпадает ни с ключом 2.8.0 (`f4e4b3e5…dba4`), ни с
  зеркальным ключом 2.8.1 (`d5e09a20…5e9a`): для перехода на 2.8.2 нужен экспорт копии,
  удаление прежней версии и импорт. APK из CI (`release.yml`) подписывается ключом
  владельца и ставится поверх без потери истории.
- Иконки 2.8.2: плоский дуотон 1:1 (набор 2.8.0 сохранён; legacy PNG во всех плотностях,
  адаптивные слои, монохромный слой).

## Что не подтверждено

- APK не запускался на физическом Android-телефоне и эмуляторе: в среде сборки нет SDK и
  системного образа Android. Проверены подпись, упаковка, состав и содержимое APK, а
  веб-часть проверена браузерными сценариями.
- `FLAG_SECURE` (защита от скриншотов) проверяется только на устройстве: в песочнице
  видно лишь то, что переключатель вызывает метод `setSecureScreen` моста Android.
- Отложенная отправка проверяется без реального ожидания срока: тест смотрит на чип
  времени и на отправку по кнопке «Отправить сейчас», а абсолютное время пресетов
  покрыто модульными тестами.
- Gradle-сборка и Android lint локально не выполнялись (домены SDK недоступны из этой
  среды); в GitHub Actions они выполняются на каждый push.
- Публичный signaling `0.peerjs.com` и сценарии между разными мобильными операторами не
  тестировались: браузерные сценарии используют локальный signaling и реальные
  WebRTC-каналы на одном хосте.
- Не заявляются: аудит безопасности, нагрузочное тестирование, фоновые push-уведомления,
  автоматическая криптографическая проверка личности собеседника.

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
