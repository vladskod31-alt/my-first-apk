# my-first-apk

Застосунок **LIBO v-1.4.6**: месенджер-подібний інтерфейс з українською, російською та англійською мовами.

## Що в репозиторії

- `LIBO_v-1.4.6_SUPER_MEGA_STABLE-6.html`: увесь застосунок в одному файлі. HTML, CSS і JavaScript вбудовані, зовнішніх бібліотек немає.
- `README.md`: цей опис.

## Запуск

Відкрийте `LIBO_v-1.4.6_SUPER_MEGA_STABLE-6.html` у браузері. Встановлювати нічого не потрібно.

Єдиний запит до зовнішнього сервісу — AI-помічник «LIBO AI». Він надсилає введений текст на `https://text.pollinations.ai/` (GET-запит, текст іде в URL).

## Збірка APK

Мета: debug APK через GitHub Actions. Workflow `.github/workflows/build-libo-apk.yml` лежить на гілці `main`. Він ставить JDK 17, запускає `./gradlew assembleDebug` і публікує артефакт `LIBO-debug-APK`.

Останній запуск упав на кроці «Build APK», бо в репозиторії немає Gradle-проєкту (`gradlew` і модуля `app/`).
