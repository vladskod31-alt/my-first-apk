# Проверка LIBO 2.8.7

Дата прогона: 2 октября 2026. Среда: Linux x64; Node.js 22.22.3; Chromium 143
(пакет `@sparticuz/chromium@143.0.4` из npm, без внешних загрузок браузеров);
OpenJDK Temurin JRE 17.0.17+10 (из npm-пакета `@node-plantuml-2/jre-linux-x64@1.1.8`);
инструменты Android (`aapt2`, `ecj`, `d8`, `apksigner`, `zipalign`, `android.jar` 35) из
внешних зеркал с закреплёнными SHA-256 в `scripts/toolchain-sources.json`. Gradle и SDK
Android в этой среде недоступны (домены загрузок заблокированы), поэтому Gradle-сборка и
lint выполняются в GitHub Actions, а не локально.

## Модульные тесты: 28 из 28 (`npm test`)

Фреймворк `node:test`, файлы `tests/core.test.mjs`. Проверки 1–24 прежних версий
(идентичности, коды контактов, границы пакетов, фото, ACK, signaling/TURN, экспорт,
код сверки, контрольные пакеты 2.5.0, вложения, MT-сессия, опросы, пакеты 2.8.1) плюс
новые проверки 2.8.7:

25. **notification policy — background, other chat, open chat, mute, off** — чистая
    функция `notificationTarget`: фон → системное сповіщення, другой открытый чат →
    банер, открытый чат/мут/выключено → ничего; `shouldSignal` учитывает мут и звук.
26. **notifier picks native first, falls back to system, counts a badge** — порядок
    каналов нативный → системный → банер, счётчик непрочитанного и сброс.
27. **bluetooth helpers validate addresses, signal bars and labels** — нормализация
    MAC-адреса, шкала RSSI, подписи устройств, короткий идентификатор из личного кода.
28. **BluetoothLink without a bridge is unsupported and BtConnection frames packets** —
    деградация без моста, кадр JSON уходит в `btSendTo` с токеном сокета, события
    оболочки разбираются в пакеты протокола, битый JSON игнорируется без падения.

## Браузерные сценарии: 11 из 11 (`npm run test:e2e`)

Playwright + Chromium, файл `tests/app.spec.mjs`, локальный signaling `peer` на том же
порту разработки. Сценарии 1–8 прежних версий (пустой старт и QR, «Избранное» и
безопасность HTML, мобильная навигация, экспорт, обмен между двумя клиентами по
настоящему WebRTC, офлайн-очередь, импорт копии, опросы/пересылка/MT/таймер) плюс:

9. **notification banner for a message in a chat that is not open** — Алиса уходит из
   чата, сообщение Богдана поднимает банер с именем и текстом; тап по банеру открывает
   нужный чат и очищает стек; в открытом чате новое сообщение остаётся без банера.
10. **Bluetooth P2P dialog opens and degrades honestly outside the APK** — чип «BT»
    открывает диалог, статус честно объясняет недоступность радиомодуля в браузере,
    кнопки управления скрыты, список пуст, вход из настроек работает.
11. **motion layer is present but reduced-motion users get none of it** — скругления
    композера 26 px на месте, при `prefers-reduced-motion` правила волны и появлений
    отключены.

## Проверки APK

- Сборка: `npm run build` → `scripts/build-apk-local.sh` (AAPT2 → ECJ → D8 → zipalign →
  подпись).
- `apksigner verify --verbose --print-certs`: схемы v1 + v2 + v3 подтверждены (v1 нужна
  для Android 8.0–8.1); сертификат `CN=LIBO Release, O=LIBO Messenger`, RSA-4096; SHA-256
  сертификата `91937ef538f670dae176559ab69b6dc3b54e4245e4a1d67783127bf0658e6bca`
  (временный ключ песочницы, см. RELEASE_NOTES.md). Полный вывод — `artifacts/SIGNING.txt`.
- `zipalign -c 4` проходит; целостность ZIP и состав APK проверены разбором архива.
- `aapt2 dump badging` (вывод в `artifacts/APK-INFO.txt`): пакет `app.libo.messenger`,
  versionCode 20807, versionName 2.8.7, minSdk 26, targetSdk 35; разрешения INTERNET,
  POST_NOTIFICATIONS, VIBRATE, FOREGROUND_SERVICE, FOREGROUND_SERVICE_DATA_SYNC и набор
  Bluetooth (BLUETOOTH/ADMIN до API 30, ACCESS_FINE_LOCATION до API 30, CONNECT/SCAN/
  ADVERTISE с флагом neverForLocation); запускаемая активность
  `app.libo.messenger.MainActivity` в теме `AppLaunchTheme`; служба
  `app.libo.messenger.ConnectionService` с `foregroundServiceType=dataSync`.
- Иконки и заставка 2.8.7 (`scripts/make-icons-287.py`): legacy PNG 48–192 px во всех
  плотностях; адаптивные слои фона и переднего плана сгенерированы **по плотностям**
  (108/162/216/324/432 px) вместо ошибочного `mipmap-anydpi-v26` в 2.8.1; логотип уложен
  в безопасную зону 66 dp; `ic_launcher_monochrome.xml`, `ic_notification.xml` и
  `ic_splash_logo.xml` пересобраны из той же геометрии; `splash_window.xml` и атрибуты
  `windowSplashScreen*` в `values-v31`/`values-night-v31` убирают чёрный экран запуска;
  контактный лист вариантов — `art/icon-287-preview.png`.
- Контрольная сумма APK: `artifacts/SHA256SUMS.txt` и `downloads/SHA256SUMS.txt`
  (значения совпадают): `a58bcaf6dbdaab7d335862c146114cbb93312775d12c6b03f5fe7b3558827546`.

## Что не подтверждено

- APK не запускался на физическом Android-телефоне и эмуляторе: в среде сборки нет SDK и
  системного образа Android. Проверены подпись, упаковка, состав и содержимое APK, а
  веб-часть проверена браузерными сценариями.
- Bluetooth P2P не проверен на реальной паре устройств (нет радиомодуля в среде):
  контракт моста покрыт юнит-тестами и сценарием деградации, нативный код проходит
  компиляцию с проверками компилятора.
- Поведение foreground-службы на оболочках с агрессивным энергосбережением (MIUI,
  OneUI и т. п.) не проверялось; известны ограничения Android 12+/14+ (см. KNOWN_ISSUES.md).
- Gradle-сборка и Android lint локально не выполнялись (домены SDK недоступны из этой
  среды); в GitHub Actions они выполняются на каждый push.
- Публичный signaling `0.peerjs.com` и сценарии между разными мобильными операторами не
  тестировались: браузерные сценарии используют локальный signaling и реальные
  WebRTC-каналы на одном хосте.
- Не заявляются: аудит безопасности, нагрузочное тестирование, облачная история,
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
python3 scripts/make-icons-287.py      # пересборка иконок и контактного листа
python3 scripts/scan-secrets.py
```

Логи: вывод `npm test` и `npm run test:e2e` перечисляет каждую проверку; в GitHub Actions
логи и артефакты прикреплены к прогону workflow; результаты подписи и упаковки APK
сохраняются в `artifacts/SIGNING.txt` и `artifacts/APK-INFO.txt`.
