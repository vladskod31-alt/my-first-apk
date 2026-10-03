# Перевірка LIBO 2.8.8

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
