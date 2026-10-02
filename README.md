# LIBO — приватный P2P-мессенджер (Android + веб)

Версия **2.8.7** · пакет `app.libo.messenger` · Android 8.0 (API 26)+ · targetSdk 35

LIBO — офлайн-способный мессенджер без аккаунтов и серверов сообщений: устройства
соединяются напрямую (WebRTC в браузере, Bluetooth RFCOMM/BLE рядом), всё общение
защищено сквозным шифрованием (X25519 + Ed25519 + Double Ratchet + ChaCha20-Poly1305
на аудированных `@noble/*`), а локальная база зашифрована в покое ключом из Android Keystore.

## Скачать

- Релиз и APK: страница релиза `v2.8.7` на GitHub (вложения перезаписаны исправленной сборкой)
  или `downloads/LIBO-2.8.7.apk` в этом репозитории.
- SHA-256: `107862110e5903561ecc3ea111f439bbed5ff8cd64070c27395e7dd1cbf1104d`
- Инструкция по обновлению (подписи тестовых сборок различаются — нужна чистая установка
  с экспортом/импортом копии): `downloads/README.md` и `RELEASE_NOTES.md`.

## Возможности

- **Сквозное шифрование**: подписанный hello, Double Ratchet, закрепление ключа
  собеседника, видимая смена идентичности, защита от даунгрейда. Архитектура —
  `docs/SECURITY_ARCHITECTURE.md`.
- **Зашифрованное хранилище**: чаты и идентичность — AES-256-GCM в IndexedDB; ключ обёрнут
  Android Keystore (`libo-vault-v1`) или неизвлекаемым WebCrypto-ключом в браузере.
  Экран блокировки: PIN + биометрия, автоблокировка, `FLAG_SECURE`.
- **Bluetooth P2P**: личные сообщения между телефонами рядом без интернета и серверов —
  RFCOMM + BLE-объявление/скан; поверх радиоканала работает то же E2EE.
- **Уведомления**: системный канал высокой важности, тап открывает чат, приватный режим
  «без текста», кнопка проверки, Web Notifications в браузере.
- **Фоновый режим** (опционально): foreground-сервис `specialUse` «LIBO на связи».
- **20+ функций в стиле Telegram**: форматирование, спойлеры, тихая отправка, закреп/архив,
  отложенные сообщения, стикеры, опросы, реакции, ответы, пересылка, обои, темы, сессии и ключи.
- **Интерфейс 2.8.7**: округлённые поверхности, ripple от точки касания + тактильный отклик,
  пружинные анимации, блик на кнопках, амбиентный приветственный экран, мобильные «листы»
  диалогов; полное уважение `prefers-reduced-motion`.
- **Иконка и сплэш исправлены**: PNG-слои в каждой плотности + векторный фон адаптивной
  иконки + monochrome-слой, стартовое окно с брендовым фоном, SplashScreen API Android 12+,
  нативный анимированный `SplashView` поверх WebView (никаких чёрных первых кадров).

## Структура репозитория

| Путь | Назначение |
|---|---|
| `web/` | веб-приложение (ES-модули + Vite): `app.js`, `index.html`, `styles.css`, `lib/` (core, transport, mtproto, storage-vault, e2ee, bluetooth) |
| `app/src/main/java/app/libo/messenger/` | нативная оболочка: `MainActivity` (мост), `BluetoothLinks`, `KeepAliveService`, `SplashView` |
| `app/src/main/res/` | иконки по плотностям, адаптивные слои, темы запуска (v31/night), сплэш-векторы |
| `scripts/` | `bootstrap-toolchain.mjs`, `build-apk-local.sh`, `dev-server.mjs`, генераторы иконок |
| `tests/` | юнит-тесты (`*.test.mjs`) и Playwright e2e (`*.spec.mjs`) |
| `docs/` | `SECURITY_ARCHITECTURE.md` |
| `downloads/` | зеркало подписанного APK + суммы |

## Сборка и проверка

```bash
node scripts/bootstrap-toolchain.mjs      # скачает android.jar, aapt2, ecj, d8, apksigner, zipalign, JRE
npm ci
npm test                                  # 34 юнит-теста (ядро, хранилище, E2EE)
npx playwright test                       # 11 e2e (нужен npx playwright install chromium)
npm run dev                               # превью на http://0.0.0.0:5173 (vite + peerjs-сигналинг)
npm run build                             # прод-бандл в dist/
export JAVA_HOME=... LIBO_TOOLCHAIN=...   # см. bootstrap-toolchain
./scripts/build-apk-local.sh              # подписанный APK в artifacts/
```

CI: `android-ci.yml` запускает тесты на каждый пуш; `release.yml` по тегу `v*` собирает,
подписывает (при наличии секретов) и публикует APK в релизе GitHub с `--clobber`.

## Документы

- `RELEASE_NOTES.md` — подробные заметки 2.8.7 и история версий.
- `TESTING.md` — как прогонять тесты и ручной чек-лист на устройстве.
- `KNOWN_ISSUES.md` — известные ограничения тестовых сборок.
- `docs/SECURITY_ARCHITECTURE.md` — модель угроз и криптоконструкции.
