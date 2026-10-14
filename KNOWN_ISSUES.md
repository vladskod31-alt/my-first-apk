# Відомі обмеження LIBO 2.11.4.5

## 1. Це не server-backed messenger

Чати — local-first 1:1 P2P. Немає account backend, persistent server queue, background
message delivery, global user directory, server global search або push. `QUEUED` означає, що
повідомлення локально очікує direct connection, а не прийняте сервером.

## 2. Calls мають реальний P2P scope

Audio/video calls використовують actual WebRTC MediaConnection і `getUserMedia`, але only 1:1
while both apps are open. Background incoming call, push/ringing service, call recording,
multi-party, phone/SIP, deployed relay guarantee and automatic redial are absent. `Reconnecting`
показується тільки коли RTCPeerConnection/ICE реально стає `disconnected`; terminal failure
потребує manual retry.

## 3. TURN/NAT

STUN не гарантує з’єднання через strict NAT, VPN або частину mobile networks. Settings приймає
explicit TURN URL/username/password, але проект не має власного production TURN, TTL credentials
або relay SLA. Не обіцяйте relay fallback без розгорнутого TURN.

## 4. Android media device matrix

APK compiled but not installed on physical Android/emulator here. `CAMERA`/`RECORD_AUDIO` are
requested only on call start/accept; actual Android WebView permission prompt, microphone/camera,
codec, Bluetooth and background behavior must be tested on API 26/29/33/35 devices.

## 5. Calls are not an audited E2EE product

WebRTC DTLS and the existing P-256/AES-GCM data-layer are not MLS, Key Transparency, ML-KEM,
post-compromise security or an independent security audit. Local IndexedDB and backups are not
encrypted at rest. Do not call the app MLS/E2EE-audited or device-bound secure storage.

## 6. Channels, groups, roles and moderation

No server-authoritative channel, group, membership, owner/admin/moderator role, permission,
ban, slow mode, admin log, tag, analytics, scheduled channel post or Channel QR exists. A
`libo://channel/...` link deliberately says a server edition is required.

## 7. Live

No channel live stream, SFU, viewer count, large-audience relay, live chat, stream recording or
LIVE state exists. The direct video call is not a live platform.

## 8. Orbix/Premium/AI/Stories

There is no real Orbix balance, charge/level/reward, Premium entitlement/payment, AI provider,
voice/video transcription, translation, Stories or Creator/Discover service. They are not
represented as disabled mock buttons.

## 9. Messaging feature gaps

Spoiler, rich text formatting, scheduled/silent messages, temporary chats, threads/topics,
quiz semantics, global search and an unread message bar remain unimplemented. Existing polls are
1:1 P2P and their tally is not anonymous/anti-fraud/accounting capable.

## 10. File/media constraints

Files up to 100 MiB are streamed as 24 KiB acknowledged chunks and verified with SHA-256, but
this was tested in browser integration, not a real 100 MiB mobile transfer. Codec playback and
thumbnail support depend on the WebView. Voice/video-to-text is absent.

## 11. Notifications

Only local reminders are implemented. New-message/mention/incoming-call/channel notifications,
mention-only mode, notification server settings and background delivery are not implemented.

## 12. Performance/device matrix

The client uses bounded local messages/chats and lazy media hydration, but server pagination,
virtualized list, server cache/priority, battery/network saver, Ultra Lite mode, low-end Android
profiling and load testing are not complete.

## 13. Signing and package identity

`LIBO-2.11.4.5-standalone.apk` is `app.libo.messenger.standalone`, signed v2/v3 with certificate
`a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910`. It updates 2.9.10.3
Standalone because package + signer match. It does not update the historic `app.libo.messenger`
package; those apps intentionally have separate data.

For the complete request-to-code matrix, see `ROADMAP_2.11.4.5.md`.
