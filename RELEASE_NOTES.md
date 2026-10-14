# LIBO 2.11.4.5 Standalone — direct WebRTC calls

**Дата збірки:** 14 жовтня 2026 · **package:** `app.libo.messenger.standalone` ·
**label:** `LIBO Standalone` · **мінімум:** Android 8.0 / API 26 · **target/compile SDK:**
35 · **versionCode:** `2110405` · **versionName:** `2.11.4.5`.

Це local-first 1:1 P2P build. PeerJS використовується для сигналізації; messages/files і
нові calls ідуть між двома активними клієнтами WebRTC. Це **не** server-backed channels,
SFU live platform, audited E2EE product, Orbix/Premium service або AI service.

## Завантаження та перевірка

| Файл | Розмір | SHA-256 |
| --- | ---: | --- |
| `downloads/LIBO-2.11.4.5-standalone.apk` | 313,723 B (≈306 KiB) | `1f123853534ec28c484772dc1daf3555114b6c50659577dad3035093e0c8a40b` |

```sh
curl -fL -O https://github.com/vladskod31-alt/my-first-apk/raw/arena/3f1b3fb8-my-first-apk/downloads/LIBO-2.11.4.5-standalone.apk
curl -fL -O https://github.com/vladskod31-alt/my-first-apk/raw/arena/3f1b3fb8-my-first-apk/downloads/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt
apksigner verify --verbose --print-certs LIBO-2.11.4.5-standalone.apk
```

## Package, signer та встановлення

`2.11.4.5` зберігає package ID `app.libo.messenger.standalone` і той самий release signer,
що й `2.9.10.3 Standalone`. Це навмисно: Android може оновити **Standalone → Standalone**
лише за незмінного package ID і certificate. Не генеруйте новий key або ID для кожного patch —
це знову зробить окремий app без його даних.

- Legacy `app.libo.messenger` і Standalone залишаються різними apps та мають окремий
  IndexedDB/WebView storage.
- Для legacy → Standalone зробіть text export у старому app, за потреби імпортуйте його
  як read-only archive в Standalone.
- APK підписаний RSA-4096 key: `CN=LIBO Release, O=LIBO Messenger`; certificate SHA-256:
  `a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910`.
- Verification підтвердила APK Signature Scheme v2 + v3. (v1 JAR signing не використано.)

## Що нового: реальні direct calls

1. **Audio Call / Video Call.** Кнопки доступні лише коли обидва online peers оголосили
   capability `calls-v1`. Передавання використовує PeerJS `MediaConnection` і реальні
   `getUserMedia` tracks, не message packet чи decorative UI.
2. **Чесні call states.** `Calling`, `Ringing`, `Connecting`, `Connected`, `Reconnecting`,
   `Failed`, `Ended` походять від MediaConnection/RTCPeerConnection. `Connected` вмикається
   лише після remote `MediaStream`.
3. **Controls.** Accept/reject, microphone mute, camera on/off, remote audio/video та
   diagnostics connection state / ICE / RTT / jitter / packet loss (лише якщо WebRTC browser
   stats це надає).
4. **Android permission boundary.** `RECORD_AUDIO` і `CAMERA` declared in manifest;
   runtime/WebView permission надається only after the user starts or accepts a call, and only
   to the local `https://appassets.androidplatform.net` origin.

## Реальні обмеження

- Потрібні два одночасно відкриті compatible LIBO 2.11.4.5 clients. Немає background
  incoming call/push, call recording, automatic redial після terminal failure, multi-party
  call або PSTN.
- Direct WebRTC може не пройти strict NAT/VPN/mobile network без TURN. Є поле для власного
  TURN URL + credentials, але repository не постачає production relay і не гарантує relay
  fallback.
- Немає channel/group calls, viewer count, live stream, SFU або live chat.
- Stories, channels, roles, server search/sessions, Orbix/Premium, AI, MLS/ML-KEM,
  Key Transparency, encrypted local DB/backups не додані й не показані як готові.

Детальна матриця всіх пунктів запиту: [ROADMAP_2.11.4.5.md](ROADMAP_2.11.4.5.md).

## Test evidence

- Node unit tests: protocol/security/file tests та MediaConnection state tests.
- Playwright: two independent browser clients establish an actual WebRTC audio call with fake
  capture devices; test waits for remote stream before accepting `Connected`.
- Local fallback toolchain: AAPT2/ECJ/D8/zipalign/apksigner verification.
- GitHub Actions: Gradle build/lint, module/browser tests, secret audit.

The browser call test is not a physical Android device test. Android WebView media behavior,
permission prompt UX, real microphone/camera, TURN on mobile NAT and long-call reliability
must still be validated on devices before a production claim.
