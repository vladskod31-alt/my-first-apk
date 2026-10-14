# APK mirror for tagged LIBO releases

This directory intentionally keeps small, directly downloadable APK mirrors for release tags.
Do not put a keystore, password, chat export, or private data here.

## 2.9.10.3 Standalone

- File: `LIBO-2.9.10.3-standalone.apk`
- Size: **305,531 bytes** (about 299 KiB)
- Package: `app.libo.messenger.standalone`
- Android: API 26+ · versionCode `2091003` · versionName `2.9.10.3`
- SHA-256: `8b79151ed87efe4adde6b0269e14b83c175479b4af61af4fa6d8e05e01b08226`
- APK Signature Schemes verified: v2 + v3
- Signer: `CN=LIBO Release, O=LIBO Messenger`
- Signer certificate SHA-256:
  `a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910`

Verify after downloading:

```sh
sha256sum -c SHA256SUMS.txt
apksigner verify --verbose --print-certs LIBO-2.9.10.3-standalone.apk
```

> **Standalone install.** This APK deliberately uses the distinct Android package
> `app.libo.messenger.standalone`. It installs alongside historic `app.libo.messenger`
> builds instead of attempting a signer-conflicting update. Its storage is separate; export
> old text history and import it manually only if needed. See `../RELEASE_NOTES.md`.

The APK was built by the pinned fallback toolchain (AAPT2/ECJ/D8/zipalign/apksigner),
compiled successfully, zipaligned, and signature-verified. It was not installed on a
physical Android device in this environment.

## Historical file

`LIBO-2.8.1.apk` remains only as a historical release mirror. Its checksum is retained in
`SHA256SUMS.txt`; do not assume it can update to or from 2.9.10.3 because signer continuity
has not been established.
