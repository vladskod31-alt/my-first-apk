# Перевірка 2.8.9.1

Локально пройшли **47 unit/API** і **17 Playwright** тестів. Команди: `npm ci && npm test && npm run test:e2e`. Окремі нові файли: `tests/orbit.test.mjs`, `tests/ads-api.test.mjs`, `tests/orbit2891.spec.mjs`.

Покрито: атомарний бонус двох вкладок, збереження/баланс/недостатні кошти, UTC і повернення годинника, колекція/ліміт історії, Premium/строк/тема, згода до API-запитів, виключення remote images/SVG/script URL, pause/cap, Bearer auth і файловий CRUD, strict events, CORS/rate limit. WebRTC використовує синтетичне аудіо, не фізичний мікрофон.

APK 2.8.9.1 зібрано fallback toolchain, перевірено apksigner v2/v3, zipalign, AAPT2 versionCode 2080901. `python3 scripts/verify-apk-icons.py artifacts/LIBO-2.8.9.1.apk` перевіряє 15 PNG та посилання launcher/splash; артефакти у `downloads/`. Скріншот `art/orbit-2891-preview.png` — браузер, не фізичний телефон.

Додано окремий GitHub emulator smoke workflow для встановлення/запуску APK на Android 35. Наявність workflow сама по собі не означає пройдений тест: фактичний статус див. Actions. Фізичні Wi-Fi Direct/NFC, аудіо між телефонами, OEM launcher та production ad-server deployment не перевірені.

Успадкований Android lint неблокувальний. Workflow тепер друкує конкретні XML-помилки як GitHub annotations і зберігає звіт; зелений загальний CI не означає lint-clean.

## Додатковий ручний чекліст
- [ ] JSON імпорт/експорт на Android через системний picker.
- [ ] Мікрофон, Wi-Fi Direct і NFC на двох реальних телефонах.
- [ ] Власний API через HTTPS, allowlist origin, токен лише на сервері, reverse proxy logs/limits.
- [ ] Чисте встановлення без видалення важливих даних; відмова оновлення з іншим сертифікатом очікувана.
- [ ] TalkBack, темна тема, великий шрифт, reduced motion, довгі рекламні тексти.

## Історична перевірка 2.8.8


## Автоматизовано

```sh
npm ci
npm test                   # 40 unit
npm run test:e2e            # 13 Playwright scenarios
npm audit
npm run build
# Android SDK/JDK 17:
./gradlew assembleDebug
# Or pinned fallback (instructions in README):
bash scripts/build-apk-local.sh
python3 scripts/verify-apk-icons.py artifacts/LIBO-2.8.8.apk
```

Пройдено 40/40 unit та 13/13 e2e. Новий аудіотест використовує дві ізольовані browser-context, реальне WebRTC й E2EE signaling; перевіряє вхідні RTP-байти, прийняття, mute, завершення, відхилення та закриття media tracks. Джерело аудіо — синтетичний AudioContext, не фізичний мікрофон.

Ручна fallback-збірка перевіряє zipalign, apksigner v2/v3 і AAPT2 badging. `verify-apk-icons.py` перевіряє посилання launcher на adaptive icon, усі 15 PNG у п’яти щільностях, їхні розміри/видимі пікселі, web icon та наявність DEX/assets. Звіт — `downloads/ICON-VERIFICATION.json`; `ICON-FROM-APK.png` витягнуто з APK. Це **не** тест встановлення чи відображення launcher на пристрої.

## Чекліст двох фізичних Android (НЕ ВИКОНАНО)

- [ ] API 26, 30, 33, 35: чисте встановлення, запуск без crash; очікувана відмова оновлення при іншому сертифікаті.
- [ ] Launcher: кругла, квадратна/adaptive та themed іконки, світла/темна тема, splash; згенероване зображення видно без обрізання.
- [ ] Один Wi-Fi/hotspot без Інтернету: канали на обох, ручний IP, прийняти контакт, перевірити номер безпеки, повідомлення в обидва боки.
- [ ] Wi-Fi Direct: відмова/дозвіл Nearby Wi-Fi/Location; вимкнений Wi-Fi, відсутність адаптера, пошук на обох, група, повторне підключення та stop.
- [ ] NFC: відсутній/вимкнений адаптер, порожня/невідома/захищена/замала мітка, запис власної NDEF-мітки, читання на другому, явне підтвердження контакту.
- [ ] Android WebView microphone: deny, allow, cancel, повторна спроба; вхідний виклик не запитує мікрофон до прийняття.
- [ ] Двостороннє чутне аудіо Wi-Fi; через мобільну мережу з TURN; Direct окремо. Виміряти затримку/якість, не лише RTP.
- [ ] Mute/відхилення/зайнято/60с timeout/втрата Wi-Fi/блокування/згортання: треки закриваються, privacy indicator зникає.
- [ ] Велике фото/черга/зміна IP/AP isolation: зрозуміла помилка, без ANR або неконтрольованого споживання пам’яті.
- [ ] TalkBack, великий шрифт, landscape, reduced motion.

Приклад після підключення тестового пристрою:

```sh
adb install artifacts/LIBO-2.8.8.apk
adb shell am start -n app.libo.messenger/.MainActivity
adb logcat -d -s AndroidRuntime
```

Не використовуйте `adb uninstall` до резервного копіювання: видалення знищує Keystore/ідентичність. CI debug має суфікс пакета `.beta` та інший сертифікат, ніж завантажуваний release APK.

## GitHub runner

Gradle `assembleDebug`, web/unit/e2e та аудит секретів підтверджені в CI. Неблокувальний Android lint **завершився кодом 1**; зелений загальний статус не означає успішний lint. Див. [повний звіт](docs/VALIDATION-2.8.8.md).
