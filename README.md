# LIBO Android · v2.10.9.3

LIBO has been rebuilt as a native Android application in Kotlin and Jetpack Compose. The old single-file HTML/WebView prototype has been removed; there is no embedded browser UI or JavaScript runtime.

## What works in this build

- Native chats, contact list, profile editor, saved messages, local groups and channels.
- Local message history, reply/edit/delete/pin/save/forward actions, file attachments and voice-note recording.
- Search across chats and contacts; chat folders and pinning.
- Ukrainian, English and Russian interface language selection; dark/light theme, motion and energy-saving preferences.
- Adaptive phone/tablet layout: phone bottom navigation, wide-screen navigation rail and two-pane chat view, scrollable settings/lists, safe system insets and keyboard-aware composer sizing.
- Password lock with a PBKDF2-SHA-256 verifier; encrypted backup export/import using AES-256-GCM and PBKDF2-SHA-256 (600,000 iterations).
- Optional OpenAI Chat Completions-compatible AI endpoint over HTTPS. The API key is protected using Android Keystore and is not included in exports/backups.
- Text contact codes can be copied/shared and imported to add a contact. QR scanning/QR joining has been removed; the text code is not a live account/network connection.
- Generated LIBO launcher icon plus scalable Android vector assets; Compose transitions and animated layout changes.

## Important scope note

This repository contains no chat server, account service, push-notification service, WebRTC signaling service, or AI API credentials. Chats, contacts and groups therefore work as a local-first prototype on this device; messages are not delivered to other users and online/presence statuses are not faked. AI requests work only after the user configures their own HTTPS-compatible endpoint, model and API key.

Encrypted backups contain app data and message metadata. They do not package the binary contents of selected documents or voice recordings; media references may only work on the original device.

## Build

Open the project in Android Studio with JDK 17 and Android SDK Platform 35, or run `./gradlew :app:assembleDebug` (Windows: `gradlew.bat :app:assembleDebug`). This sandbox has no JDK or Android SDK, so an APK could not be built or emulator-tested here.

The app module is `app/`, application id `app.libo.android`, minimum Android API 26, version name `2.10.9.3`.

## Icon

- Generated source artwork: [`assets/libo-app-icon.png`](assets/libo-app-icon.png)
- Vector mark source: [`assets/libo-mark.svg`](assets/libo-mark.svg)
- Android launcher resources: `app/src/main/res/mipmap-*` and `app/src/main/res/mipmap-anydpi-v26/`
