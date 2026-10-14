# Безпека LIBO 2.11.4.5

## Чесна security boundary

LIBO 2.11.4.5 — local-first 1:1 P2P клієнт. Це **не** audited end-to-end encryption
product, MLS group implementation, Key Transparency deployment, post-compromise security
system, hybrid X25519 + ML-KEM protocol або encrypted-server service. Не називайте його таким
без незалежного security review і необхідної server/key infrastructure.

Поточний direct chat використовує WebRTC DTLS. Коли обидва клієнти підтримують наявний
MT-inspired layer, він additionally використовує ephemeral P-256 ECDH + HKDF/AES-256-GCM
over the DataChannel with replay rejection. Це implementation detail, не заміна audited MLS
або формальної E2EE claim. Short authentication string має бути звірений людьми поза каналом.

## Direct audio/video call

- Call uses real PeerJS `MediaConnection` / browser `getUserMedia`; media is carried by
  WebRTC. `Connected` appears only after a remote `MediaStream` is received.
- The application never grants capture based only on a remote packet: accept/start requires a
  local user action; Android receives runtime permission request at that point.
- `MainActivity` grants WebView capture only to `https://appassets.androidplatform.net`, only
  `RESOURCE_AUDIO_CAPTURE` / `RESOURCE_VIDEO_CAPTURE`, and only after matching Android
  `RECORD_AUDIO` / `CAMERA` runtime permissions. Unknown origin/resource is denied.
- No call recording, server media relay guarantee, background call service, call history,
  group call or SFU exists. A user-provided TURN endpoint is sensitive configuration and must
  not be exported or committed.

## Client data and files

- Messages, drafts, known contact profiles, attachment records/chunks and local queue live in
  WebView IndexedDB. Clearing Android app data removes them. The database is **not encrypted at
  rest** and Android Keystore/device-bound key protection has not been implemented.
- Attachments are bounded by MIME/size, named with safe filenames, use generated file IDs,
  persist chunks before receipt, then require exact byte size + SHA-256 before a file ACK.
  Blob data does not cross the data channel as a giant Base64 message.
- HTML/message content is rendered through DOM text nodes, not `innerHTML`; mentions are bounded
  and resolved from known local contacts. `libo://` input is strict host/path only and checked in
  Java and JS. Remote HTML cannot be loaded in the WebView that exposes `LiboAndroid`.

## What is deliberately absent

There is no server account/session model, remote logout/key revocation, server-side rate limit,
channel role enforcement, encrypted backup/restore, anonymous credential, sealed sender,
payment/Orbix ledger, Premium entitlement, AI provider or global discovery index. No UI label
claims any of these exist. The full capability matrix is in `ROADMAP_2.11.4.5.md`.

## APK 2.11.4.5

```text
Package: app.libo.messenger.standalone
Label: LIBO Standalone
Version: 2.11.4.5 (2110405)
Signer DN: CN=LIBO Release, O=LIBO Messenger
Signer certificate SHA-256: a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910
APK schemes verified: v2, v3
APK SHA-256: 1f123853534ec28c484772dc1daf3555114b6c50659577dad3035093e0c8a40b
```

Verify:

```sh
sha256sum -c downloads/SHA256SUMS.txt
apksigner verify --verbose --print-certs downloads/LIBO-2.11.4.5-standalone.apk
```

The private keystore/password are not in Git. The signing continuity is intentionally retained
for Standalone updates; it does not establish continuity with legacy `app.libo.messenger`.

## Reporting a vulnerability

Do not publish exploit steps, private keys, credentials, chat data, call recordings or full
backups in a public issue. Use private GitHub security reporting for the repository if enabled,
or contact its owner privately. Include the exact APK hash/version, Android/WebView version,
minimal reproduction, affected component, impact and a safe proof of concept where possible.
