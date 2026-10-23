# APK mirror for tagged LIBO releases

This directory keeps directly downloadable, verified signed APK mirrors alongside their SHA-256 checksums, `aapt2` package metadata, and `apksigner` certificate reports. Never commit a private keystore, password, chat export, TURN credential, or personal data here.

## Current Orb Edition: 2.11.9.5 (`app.libo.messenger.orb`)

- File: `LIBO-2.11.9.5.apk`
- GitHub Release asset: [LIBO-2.11.9.5.apk](https://github.com/vladskod31-alt/my-first-apk/releases/download/v2.11.9.5/LIBO-2.11.9.5.apk)
- Size: **1,321,549 bytes** (~1.26 MiB)
- Package: `app.libo.messenger.orb` (dedicated package ID — installs cleanly alongside `app.libo.messenger.standalone` without uninstalling 2.12.0)
- Label: `LIBO`
- Icon: Purple/pink 3D chat-orb (`art/libo-2d-1024.png`)
- Android: API 26+ (Android 8.0–15+) · `versionCode` `2110905` · `versionName` `2.11.9.5`
- SHA-256: `5643f8c467e726bc74ad6b193e922ecf108e45738efbe73802daa278535a7ab4`
- APK Signature Schemes verified: v2 + v3 (no v1 JAR signing)
- Signer: `CN=LIBO Orb Release, O=LIBO Messenger`, RSA-4096
- Signer certificate SHA-256:
  `db8f5aaddd6fb93e7861bb9e4eefb3cb75f2595c149de102ea635d1cc1a94353`

Companion files: `SHA256SUMS-2.11.9.5.txt`, `APK-INFO-2.11.9.5.txt`, `SIGNING-2.11.9.5.txt`.

Verify after downloading:

```sh
curl -fL -O https://github.com/vladskod31-alt/my-first-apk/releases/download/v2.11.9.5/LIBO-2.11.9.5.apk
curl -fL -O https://github.com/vladskod31-alt/my-first-apk/releases/download/v2.11.9.5/SHA256SUMS-2.11.9.5.txt
sha256sum -c SHA256SUMS-2.11.9.5.txt
apksigner verify --verbose --print-certs LIBO-2.11.9.5.apk
```

## Standalone line: 2.12.0 (`app.libo.messenger.standalone`)

- File: `LIBO-2.12.0.apk`
- Size: **326,011 bytes** (about 319 KiB)
- Package: `app.libo.messenger.standalone`
- Label: `LIBO Standalone`
- Android: API 26+ · `versionCode` `2120000` · `versionName` `2.12.0`
- SHA-256: `b2453f38a6058957dcd49df521a8538de0ff81bf9d5530491cbc65e516ad7742`
- APK Signature Schemes verified: v2 + v3 (no v1 JAR signing)
- Signer: `CN=LIBO Release, O=LIBO Messenger`, RSA-4096
- Signer certificate SHA-256:
  `b102233e1040405097bbb0564798521be0c043abfd616d1c5548c5fadd176371`

Companion files: `SHA256SUMS-2.12.0.txt`, `APK-INFO-2.12.0.txt`, `SIGNING-2.12.0.txt`.
Screenshots of the interface live in `art/screens/`.

## Previous builds

- `LIBO-2.11.4.5-standalone.apk` — 313,723 B ·
  `1f123853534ec28c484772dc1daf3555114b6c50659577dad3035093e0c8a40b`
- `LIBO-2.9.10.3-standalone.apk` — 305,531 B ·
  `8b79151ed87efe4adde6b0269e14b83c175479b4af61af4fa6d8e05e01b08226`
- `LIBO-2.8.1.apk` — 280,955 B ·
  `47d67439f22eb3db3e704a2075b1df0449e5de01853e2a0b723a3ad5acd4536b`
