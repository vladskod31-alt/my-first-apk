# LIBO 2.8.7 для Android

Тег релиза: `v2.8.7` · тестовая версия · пакет `app.libo.messenger` · Android 8.0 (API 26) и новее

## Скачать

| Файл | Ссылка | Формат |
|---|---|---|
| Установочный APK (основная ссылка) | `downloads/LIBO-2.8.7.apk` каталога тега `v2.8.7` | ~420 КБ |

Контрольная сумма SHA-256: `a58bcaf6dbdaab7d335862c146114cbb93312775d12c6b03f5fe7b3558827546`
(файл `downloads/SHA256SUMS.txt` тега `v2.8.7`).

Проверка:

```bash
curl -fsSL https://github.com/vladskod31-alt/my-first-apk/raw/refs/tags/v2.8.7/downloads/SHA256SUMS.txt | sha256sum -c -
# macOS: shasum -a 256 LIBO-2.8.7.apk
# Windows PowerShell: (Get-FileHash LIBO-2.8.7.apk -Algorithm SHA256).Hash
```

## Подпись

Схема подписи — RSA-4096, v1 + v2 + v3 (v1 нужен для установки на Android 8.0–8.1).
Отпечаток сертификата **этой сборки**:

```text
Signer #1 certificate SHA-256 digest: 91937ef538f670dae176559ab69b6dc3b54e4245e4a1d67783127bf0658e6bca
Owner: CN=LIBO Release, O=LIBO Messenger
```

Релизный кейстор владельца хранится вне репозитория и в среду сборки не передаётся,
поэтому APK из `downloads/` подписан временным тестовым ключом песочницы (отпечаток
выше). Он не совпадает с ключами 2.8.0 (`f4e4b3e5…dba4`) и 2.8.1 (`d5e09a20…`), поэтому
обновление поверх старой версии невозможно: сначала Настройки → «Резервная копия:
экспорт текста», затем удаление прежней LIBO, установка 2.8.7 и импорт копии.
Свежая установка не требует ничего дополнительного.

## Что нового в 2.8.7

1. **Bluetooth P2P для личных сообщений.** Новый транспорт рядом с WebRTC: два
   устройства обмениваются сообщениями напрямую по радиоканалу — без интернета,
   сигнального сервера и TURN. Классический RFCOMM несёт кадры протокола, BLE-реклама
   и поиск находят соседей, а поверх канала работает тот же MT-слой (ECDH P-256 +
   AES-256-GCM), что и поверх WebRTC. Вход: чип «BT» в списке чатов или Настройки →
   «Bluetooth P2P…»; там же список устройств поруч и активные ЛС-каналы.
2. **Сповіщення, которые действительно приходят.** Системное уведомление о сообщении,
   пришедшем в фоне; анимированный баннер внутри приложения, когда открыт другой чат;
   счётчик непрочитанного на иконке-уведомлении. Опция «Фоновий режим» поднимает
   foreground-службу с постоянным уведомлением, которая держит соединение, пока LIBO
   свёрнут (без FCM и без серверов — как и планировалось в KNOWN_ISSUES.md).
3. **Иконка и заставка исправлены и перерисованы.** В 2.8.1 адаптивные слои иконки
   лежали в `mipmap-anydpi-v26`, где битмы не масштабируются по плотности: на всех
   устройствах кроме xxxhdpi лаунчер вырезал логотип напрочь, а экран заставки Android
   12+ показывал тёмное окно без логотипа («чёрный фон»). В 2.8.7: слои фона и
   переднего плана сгенерированы для каждой плотности (108–432 px), логотип уложен в
   безопасную зону 66 dp, monochrome-слой для тематических иконок Android 13+
   перерисован по той же геометрии, добавлены атрибуты splash-экрана Android 12+
   (`windowSplashScreenBackground/AnimatedIcon`), брендовое окно запуска для старых
   версий и анимированная нативная заставка с логотипом (кольца, overshoot, блик).
   Новый знак — белый пузырь с двойной зелёной стрелкой и лаймовой точкой.
4. **Мощный проход по интерфейсу.** Более скруглённые формы (пузыри 22 px, композер
   26 px, диалоги 30 px и мобильные «листы» снизу), пружинные нажатия кнопок с волной
   от точки касания и бликом на основных кнопках, анимации появления сообщений и
   баннеров, «печатає…» с точками, пульс онлайн-статуса, амбиентные пятна на
   приветственном экране, тактильная отдача на ключевых действиях. Всё отключается
   системной настройкой prefers-reduced-motion.
5. **Версия и бейдж.** `versionName 2.8.7`, `versionCode 20807`; бейдж в списке чатов —
   «v2.8.7»; экран «О LIBO» перечисляет 13 возможностей версии.

Функции 2.5.0–2.8.1 сохранены полностью: голосовые, файлы и видео до 1,5 МБ, правки,
удаление для обоих, закреп, реакции, близкие контакты, статус «был(а) в сети», импорт
копии, сводка безопасности, QR личного кода, ответы, «Избранное», поиск, MT-слой
защиты, папки, пересылка, секретный таймер, галочки прочтения, опросы, код-замок PIN,
фоны, мультивыбор, глобальный поиск, без звука для чата.

## Установка и обновление

1. Скачайте `LIBO-2.8.7.apk` из каталога `downloads/` тега `v2.8.7` и проверьте SHA-256.
2. Разрешите установку из браузера или файлового менеджера (Android 8–13), либо откройте
   файл напрямую (Android 14+).
3. При первом запуске разрешите уведомления (Android 13+), а для Bluetooth P2P —
   доступ «устройства рядом» (Android 12+) или геолокацию (Android 8–11, только для
   поиска Bluetooth).
4. Откройте LIBO на обоих устройствах и обменяйтесь личными кодами — или включите
   Bluetooth P2P на обоих и соединитесь из списка «Пристрої поруч».

Обновление с любой прежней версии — через экспорт копии, удаление и чистую установку
(ротация ключа подписи, см. выше).

## Проверка сборки

Модульные тесты (`npm test`, 28 проверок) и браузерные сценарии (`npm run test:e2e`,
включая сценарии сповіщень и Bluetooth-диалога) прогоняются локально и в CI. Сборка —
`scripts/build-apk-local.sh` (без Gradle, закреплённый внешний toolchain) или
`./gradlew assembleDebug/assembleRelease` в среде с SDK Android. Манифест: код 20807,
minSdk 26, targetSdk 35, разрешения INTERNET, POST_NOTIFICATIONS, VIBRATE,
FOREGROUND_SERVICE(_DATA_SYNC) и набор Bluetooth; `debuggable=false`.

## English summary

LIBO 2.8.7 is the "powerful" release. It adds a Bluetooth P2P transport for direct
messages (RFCOMM data channel + BLE advertising/discovery, same MT protection layer as
WebRTC), real notifications (system notification for background messages, in-app
animated banner, opt-in foreground keep-alive service with a persistent notification),
a fully fixed and redesigned launcher icon and splash screen (2.8.1 shipped unscaled
anydpi adaptive layers and no splash attributes, which produced a cropped/blank icon
and a black splash), and a motion pass: rounder surfaces, springy ripple buttons,
message/banner entrance animations, typing dots, haptics — all honouring
prefers-reduced-motion. versionName 2.8.7, versionCode 20807. The sandbox-built APK is
signed with a temporary key, so updates from older versions need export, uninstall and
a clean install.
