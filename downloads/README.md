# APK mirror for tagged LIBO releases

This directory intentionally keeps directly downloadable APK mirrors. Do not put a keystore,
password, chat export, TURN credential, or private data here.

## Current: 2.12.0 Standalone

- File: `LIBO-2.12.0.apk`
- Size: **326,011 bytes** (about 319 KiB)
- Package: `app.libo.messenger.standalone`
- Label: `LIBO Standalone`
- Android: API 26+ · versionCode `2120000` · versionName `2.12.0`
- SHA-256: `b2453f38a6058957dcd49df521a8538de0ff81bf9d5530491cbc65e516ad7742`
- APK Signature Schemes verified: v2 + v3 (no v1 JAR signing)
- Signer: `CN=LIBO Release, O=LIBO Messenger`, RSA-4096
- Signer certificate SHA-256:
  `b102233e1040405097bbb0564798521be0c043abfd616d1c5548c5fadd176371`

Companion files: `SHA256SUMS-2.12.0.txt`, `APK-INFO-2.12.0.txt`, `SIGNING-2.12.0.txt`.
Screenshots of the 2.12 interface live in `art/screens/`.

Verify after downloading:

```sh
curl -fL -O https://github.com/vladskod31-alt/my-first-apk/raw/main/downloads/LIBO-2.12.0.apk
curl -fL -O https://github.com/vladskod31-alt/my-first-apk/raw/main/downloads/SHA256SUMS-2.12.0.txt
sha256sum -c SHA256SUMS-2.12.0.txt
apksigner verify --verbose --print-certs LIBO-2.12.0.apk
```

> The 2.12.0 build is signed with a **new** key: the private key of earlier builds was never
> committed. Android therefore treats it as a separate install, not an in-place update of
> 2.11.4.5. Keep `~/.local/share/libo/release.keystore` (or the CI secrets
> `LIBO_KEYSTORE_BASE64`, `LIBO_KEYSTORE_PASSWORD`, `LIBO_KEY_ALIAS`) to keep one signer for
> future versions.

## Prerelease rollback: 2.11.9.5

- Asset: [LIBO-2.11.9.5.apk](https://github.com/vladskod31-alt/my-first-apk/releases/download/v2.11.9.5/LIBO-2.11.9.5.apk)
- Package: `app.libo.messenger.standalone` · versionCode `2110905` · versionName `2.11.9.5`
- Verification files: `SIGNING.txt`, `APK-INFO.txt`, and `SHA256SUMS.txt` are attached to the same GitHub release.
- This is a prerelease rollback below 2.12.0 (`2120000`), not a newer update. Android requires uninstalling 2.12.0 first; that may erase local chats and attachments. Export a backup before uninstalling.

## Previous builds

- `LIBO-2.11.4.5-standalone.apk` — 313,723 B ·
  `1f123853534ec28c484772dc1daf3555114b6c50659577dad3035093e0c8a40b`
- `LIBO-2.9.10.3-standalone.apk` — 305,531 B
- `LIBO-2.8.1.apk` — 280,955 B
