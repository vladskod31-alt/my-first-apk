# APK mirror for tagged LIBO releases

This directory intentionally keeps small, directly downloadable APK mirrors for release tags.
Do not put a keystore, password, chat export, or private data here.

## 2.9.10.3

- File: `LIBO-2.9.10.3.apk`
- Size: **305,531 bytes** (about 299 KiB)
- Package: `app.libo.messenger`
- Android: API 26+ · versionCode `2091003` · versionName `2.9.10.3`
- SHA-256: `235a3292c4f0d0a906bef47dcf214da5324a1e23a23f3f9971c4d5818a1ae0c5`
- APK Signature Schemes verified: v2 + v3
- Signer: `CN=LIBO Release, O=LIBO Messenger`
- Signer certificate SHA-256:
  `a1b522d513f569a6c081ec12e4aeaab9cf3dbcd394b70b6f26ee779cc2d91910`

Verify after downloading:

```sh
sha256sum -c SHA256SUMS.txt
apksigner verify --verbose --print-certs LIBO-2.9.10.3.apk
```

> **Update warning.** The 2.9.10.3 APK was signed by a test key generated in the Arena
> build environment. It is not confirmed to match the historic 2.8.1 signer, so Android
> may refuse an in-place update. Export any needed text backup, uninstall the older build
> if asked, and then install this APK. See `../RELEASE_NOTES.md` and `../TESTING.md`.

The APK was built by the pinned fallback toolchain (AAPT2/ECJ/D8/zipalign/apksigner),
compiled successfully, zipaligned, and signature-verified. It was not installed on a
physical Android device in this environment.

## Historical file

`LIBO-2.8.1.apk` remains only as a historical release mirror. Its checksum is retained in
`SHA256SUMS.txt`; do not assume it can update to or from 2.9.10.3 because signer continuity
has not been established.
