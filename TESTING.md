# Проверка LIBO 2.6.0

Дата прогона: 12 сентября 2026. Среда: Linux x64; Node.js 22.22.3; Chromium 143
(пакет `@sparticuz/chromium@143.0.4` из npm, без внешних загрузок браузеров);
OpenJDK Temurin JRE 17.0.17+10 (из npm-пакета `@node-plantuml-2/jre-linux-x64@1.1.8`);
инструменты Android (`aapt2`, `ecj`, `d8`, `apksigner`, `zipalign`, `android.jar` 35) из
внешних зеркал с закреплёнными SHA-256 в `scripts/toolchain-sources.json`. Gradle и SDK
Android в этой среде недоступны (домены загрузок заблокированы), поэтому Gradle-сборка и
lint выполняются в GitHub Actions, а не локально.

## Модульные тесты: 21 из 21 (`npm test`)

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
18. verification code is stable, symmetric and unambiguous (новое в 2.3.0)
19. verification code depends on both identities
20. 2.5.0 control packets validate and reject malformed input (edit/delete/pin/react)
21. attachments are bounded and mime-checked (voice/video/file, лимиты base64) (новое в 2.3.0)

## Браузерные сценарии: 7 из 7 (`npm run test:e2e`)

Playwright + Chromium, файл `tests/app.spec.mjs`, локальный signaling `peer` на том же
порту разработки. Сценарии:

1. **real welcome, no invented contacts, valid QR and source links** — пустой старт без
   вымышленных контактов, личный код формата `LIBO:libo-…`, валидный SVG-QR, ссылка на
   репозиторий, отсутствие ошибок страницы.
2. **saved messages, literal HTML, drafts, search, theme and reload** — «Избранное»,
   внедрённый `<img onerror>` остаётся текстом и не исполняется, черновики переживают
   перезагрузку, поиск, переключение темы. В 2.3.0 дополнительно: в «Избранном» пункт
   «Код сверки» скрыт.
3. **mobile navigation, input validation, profile and no horizontal overflow** — экран
   360 px, навигация назад, отклонение некорректного кода контакта, отсутствие
   горизонтальной прокрутки.
4. **text export contains notes but never private contact identity** — скачанный JSON
   содержит заметки, но не личный код профиля и не TURN-пароли.
5. **two independent clients exchange text, delivery ACK, reply and real photo** — два
   изолированных браузерных контекста соединяются по настоящему WebRTC DataChannel через
   локальный signaling: текст, статус «доставлено» после сохранения у получателя, ответ с
   цитатой, фотография в base64 декодируется в `img`. В 2.3.0 дополнительно: код сверки
   одинаков на обеих сторонах и соответствует формату `XXXX XXXX XXXX`.
6. **offline queue survives sender reload and is delivered exactly once after reconnect** —
   сообщение, написанное при закрытом получателе, переживает перезагрузку отправителя и
   доставляется ровно один раз после возвращения получателя.
7. **backup import becomes read-only archive and close contacts stay on top** — импорт
   JSON-копии создаёт архив только для чтения с плашкой, звезда поднимает контакт выше
   обычных чатов. Сценарий 5 дополнительно проверяет реакции, закреп с панелью с обеих
   сторон, правку с отметкой «изменено», удаление для обоих и доставку файла с именем.

## Проверки APK

- Сборка: `npm run build` → `scripts/build-apk-local.sh` (AAPT2 → ECJ → D8 → zipalign →
  подпись).
- `apksigner verify --verbose --print-certs`: схемы v2 и v3 подтверждены, v1 не требуется
  для minSdk 26; сертификат `CN=LIBO Release, O=LIBO Messenger`, RSA-4096; SHA-256
  сертификата `3bb3878c0b3dd9ec3a31905da3a22fd7730a72ca83cf9421e582f70b527510e0`.
  Полный вывод сохраняется в `artifacts/SIGNING.txt`.
- `zipalign -c 4` проходит; целостность ZIP и состав APK проверены разбором архива.
- `aapt2 dump badging` (вывод в `artifacts/APK-INFO.txt`): пакет `app.libo.messenger`,
  versionCode 20600, versionName 2.6.0, minSdk 26, targetSdk 35, единственное разрешение
  `android.permission.INTERNET`, запускаемая активность
  `app.libo.messenger.MainActivity`, иконка `mipmap-anydpi-v26/ic_launcher.xml` во всех
  плотностях, в assets входят `index.html`, JS/CSS-бандл, шрифты WOFF2, `icon.svg`,
  `icon-192.png`, `icon-512.png` и `third-party-notices.txt`.
- Контрольная сумма APK: `artifacts/SHA256SUMS.txt` и `downloads/SHA256SUMS.txt`
  (значения совпадают): `3926549d9237067f9bfcbba4ecbb6c9c700259bcf2621b982a3920041f99cb2e`.
- Иконки 2.6.0: плоский 2D-набор (legacy PNG во всех плотностях, адаптивные слои, монохромный слой) присутствует
  в APK; веб-фавикон и `icon-512.png` входят в assets.

## Что не подтверждено

- APK не запускался на физическом Android-телефоне и эмуляторе: в среде сборки нет SDK и
  системного образа Android. Проверены подпись, упаковка, состав и содержимое APK, а
  веб-часть проверена браузерными сценариями.
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
