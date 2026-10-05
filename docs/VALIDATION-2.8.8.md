# Звіт перевірки 2.8.8 — 2026-10-03

## Підтверджено

- 40 модульних тестів; 13 Playwright-сценаріїв, включно з реальним WebRTC RTP між двома браузерними клієнтами із синтетичним джерелом аудіо.
- Локальна fallback-збірка підписаного release APK, zipalign, підпис v2/v3, AAPT2 package/version/permissions.
- GitHub Actions: `assembleDebug` успішний; unit/e2e та збірка вебчастини успішні; аудит Git на секрети успішний.
- [CI run](https://github.com/vladskod31-alt/my-first-apk/actions/runs/37117267426).
- [Публікація через GitHub runner](https://github.com/vladskod31-alt/my-first-apk/actions/runs/37117267405): перед upload повторно перевірені checksum, сертифікат, zipalign і пакет. У Releases є APK, patch від 2.8.7, контрольні суми, сертифікат і звіт іконки.
- 15 PNG launcher-ресурсів усередині APK збігаються за розмірами та видимими пікселями; adaptive/round/splash посилаються на новий foreground. Web icon також збігається. `downloads/ICON-FROM-APK.png` витягнуто з APK.
- `npm audit`: 0 відомих вразливостей на момент збірки.

## Не пройдено / не перевірено

- **Android lint завершився кодом 1.** Успадкований workflow має `continue-on-error`, тому зелений CI не означає чистий lint. Логи lint не вдалося отримати із sandbox через обрив з’єднання із сервером логів; причину не встановлено. Не називаємо збірку lint-clean.
- Немає `adb install`, запуску на емуляторі/фізичному Android, перевірки реального launcher, Wi-Fi Direct, NFC або чутного дзвінка між двома телефонами. Це наступний ручний етап, не автоматично підтверджені функції.
- Новий сертифікат відрізняється від 2.8.7. Встановлення поверх іншого підпису не підтримується; див. попередження про експорт і втрату ідентичності у `downloads/README.md`.
- Короткий GitHub About/description не оновлено: API відповів `403 Resource not accessible by integration`. README, changelog, release notes та PR опубліковані. Google Play/сторонні магазини не змінювалися.

SHA-256 завантажуваного APK: `d40b42c4cdf64cf94ce100b4afa81dac3c4c1ef62daa0c04e3e4297de3ce6c45`.

Тег `v2.8.8` — незмінний commit `eb284eb23bf420976915fc7d7e4b10d23b7a09b3`; подальші commits цієї гілки додають лише workflow публікації й документацію, не замінюють APK у тезі.
