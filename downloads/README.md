# APK mirror for tagged/review LIBO releases

This directory intentionally keeps directly downloadable APK mirrors. Do not put a keystore,
password, chat export, TURN credential, or private data here.

## Current: 2.11.4.5 Standalone

- File: `LIBO-2.11.4.5-standalone.apk`
- Size: **313,723 bytes** (about 306 KiB)
- Package: `app.libo.messenger.standalone`
- Label: `LIBO Standalone`
- Android: API 26+ · versionCode `2110405` · versionName `2.11.4.5`
- SHA-256: `1f123853534ec28c484772dc1daf3555114b6c50659577dad3035093e0c8a40b`
- APK Signature Schemes verified: v2 + v3
- Signer: `CN=LIBO Release, O=LIBO Messenger`
- Signer certificate SHA-256:
  `a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910`

Verify after downloading:

```sh
sha256sum -c SHA256SUMS.txt
apksigner verify --verbose --print-certs LIBO-2.11.4.5-standalone.apk
```

> **Install path.** This package deliberately differs from historic
> `app.libo.messenger`, so it installs next to legacy LIBO without a signer conflict.
> It uses the same package and signer as `2.9.10.3 Standalone`, therefore Android can update
> that Standalone app in place. Its data is separate from legacy LIBO; export/import old text
> history manually only if needed.

The APK has a real direct 1:1 WebRTC call implementation. It is not a channel/live/SFU,
server messaging, Orbix/Premium, AI, or audited-MLS release. Details and limits:
`../RELEASE_NOTES.md` and `../ROADMAP_2.11.4.5.md`.

## Historical mirrors

- `LIBO-2.9.10.3-standalone.apk` is the preceding Standalone build.
- `LIBO-2.8.1.apk` remains a historical mirror only.

Their checksums remain in `SHA256SUMS.txt`. Do not assume old legacy packages can update to
Standalone; only the 2.9.10.3 → 2.11.4.5 Standalone path has matching package/signing identity.
