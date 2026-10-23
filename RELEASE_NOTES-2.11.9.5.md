# LIBO 2.11.9.5 — Orb Edition (нова іконка, новий ID пакета та релізний підпис)

**Android `versionName`:** `2.11.9.5` · **`versionCode`:** `2110905` · **Package ID (`applicationId`):** `app.libo.messenger.orb` · **Android:** 8.0+ (API 26–35).

## Прямі посилання для завантаження APK

- **GitHub Releases (`v2.11.9.5`):** [LIBO-2.11.9.5.apk](https://github.com/vladskod31-alt/my-first-apk/releases/download/v2.11.9.5/LIBO-2.11.9.5.apk)
- **Дзеркало в репозиторії (`downloads/`):** [downloads/LIBO-2.11.9.5.apk](https://github.com/vladskod31-alt/my-first-apk/raw/main/downloads/LIBO-2.11.9.5.apk)
- **Розмір файла:** `579 764` байтів (~566 KiB)
- **SHA-256 APK:** `750d540514ef974a6ab1a4acd661a2c6c652cb52a50f195c175bdcaef8be5b5e`

## Що нового у збірці 2.11.9.5

- **Нова іконка Chat-Orb:** оновлена фіолетово-рожева 3D-іконка LIBO без швів контуру та з чистим світловим відблиском для всіх щільностей Android (`mipmap-mdpi` … `mipmap-xxxhdpi`), адаптивної іконки Android 8+ (`ic_launcher_background` + `ic_launcher_foreground`), монохромної іконки Android 13+ (`ic_launcher_monochrome`) та веб-іконок (`icon-192.png`, `icon-512.png`, `icon.svg`, `art/libo-2d-1024.png`).
- **Новий ідентифікатор пакета (`app.libo.messenger.orb`):** APK встановлюється на телефон чисто і без конфліктів підпису або версії поруч із `LIBO Standalone 2.12.0` (`app.libo.messenger.standalone`) чи старішими збірками — видаляти попередній застосунок не потрібно.
- **Релізний криптографічний підпис (APK Signature Scheme v2 + v3):** підписано ключем RSA-4096 (`CN=LIBO Orb Release, O=LIBO Messenger`), вирівняно `zipalign` (4 байти) та перевірено `apksigner`.
- **Оновлений Orb UI та навігація:** фіолетово-рожевий орбітальний індикатор завантаження бази та чернеток, чесний індикатор стану сигнального сервера PeerJS і локального сховища на пристрої, підписана мобільна навігація та всі 9 функцій полірованого інтерфейсу.
- **Автономна публікація релізу в CI:** workflow публікації та релізу працює автоматично з перевіреного релізного дзеркала `downloads/` (або генерує ключ підпису за відсутності секретів), без блокування на відсутніх `LIBO_KEYSTORE_BASE64` / `LIBO_KEYSTORE_PASSWORD`.

## Підпис та перевірка цілісності

- **Підписувач (DN):** `CN=LIBO Orb Release, O=LIBO Messenger`
- **Алгоритм і розмір ключа:** `RSA`, `4096` біт
- **Схеми підпису APK:** `v2: true`, `v3: true` (`v1: false`)
- **SHA-256 сертифіката підписувача:** `db8f5aaddd6fb93e7861bb9e4eefb3cb75f2595c149de102ea635d1cc1a94353`
- **SHA-256 публічного ключа:** `70a1df2095f744d29c4eec5a8fd200c8193cb3a3a3bd38aabf537413187592c5`

Файли у релізі та в каталозі `downloads/`:

- `LIBO-2.11.9.5.apk` — підписаний і вирівняний релізний APK.
- `SHA256SUMS-2.11.9.5.txt` / `SHA256SUMS.txt` — контрольні суми SHA-256.
- `SIGNING-2.11.9.5.txt` / `SIGNING.txt` — звіт `apksigner verify --verbose --print-certs`.
- `APK-INFO-2.11.9.5.txt` / `APK-INFO.txt` — метадані пакета `aapt2 dump badging`.

Перевірка після завантаження:

```sh
sha256sum -c SHA256SUMS-2.11.9.5.txt
apksigner verify --verbose --print-certs LIBO-2.11.9.5.apk
```
