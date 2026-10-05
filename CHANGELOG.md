# Changelog

## 2.8.9.1 — 2026-10-05 (experimental)

- Added local Orbit Premium, fictional coins/stars, daily UTC grant, exchange, collectibles and bounded ledger; atomic cross-tab wallet transactions.
- Added opt-in Ad Studio with schedules, weighted rotation, caps/cooldowns, CRUD, raster artwork and JSON import/export.
- Added self-hosted Advertising API v1: validated feed/events, authenticated administration, atomic single-process persistence and basic rate limits. Not a hosted network or billing service.
- Added 7 unit/API tests and 4 browser tests (47 unit/API + 17 browser total).
- Fixed Android file chooser MIME handling and native ad-campaign JSON export.
- Kept 2.8.8 icon, messaging and foreground calls. APK version 2.8.9.1, npm SemVer 2.8.9-1.
- Explicit limits: virtual local currency only; no real payments/earnings, no Telegram affiliation, no groups/channels/cloud sync/stories/Bot API/video in this patch. New temporary signing certificate.


## 2.8.8 — 2026-10-03 (experimental)

### Added
- Opt-in native LAN sockets on shared Wi-Fi/hotspot and Wi-Fi Direct discovery/group connection.
- Foreground audio calls: WebRTC DTLS-SRTP, E2EE SDP, answer/reject/busy/mute/hangup, bounded setup timeout, microphone cleanup.
- NFC NDEF invitation reader/writer with explicit contact confirmation (not Android Beam).
- Generated launcher artwork integrated at five densities, adaptive/round/themed icons, splash and web branding.
- Press/dialog/call animation and reduced-motion support.
- Call unit/integration tests and built-APK icon verification, extracted APK artwork.

### Fixed
- Android manifest foreground-service class mismatch.
- Local socket lifetime across signaling reconnect and mandatory E2EE for LAN application messages.
- Origin-restricted WebView microphone permission bridge.
- Release workflow refuses unsigned publication without signing secrets.
- Known npm development dependency advisories.

### Limitations
- New temporary signing certificate: not an in-place update over different-signed builds.
- Android installation, physical Wi-Fi Direct/NFC and two-phone audio not tested. Foreground calls only.
- NFC uses formatted tags, no phone-to-phone Beam or audio. Export/import is text-only, read-only archive.

## 2.8.7 (historical)

See [archived release notes](docs/releases/2.8.7.md). The v2.8.7 tag is not modified by this update.
