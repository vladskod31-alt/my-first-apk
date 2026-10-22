# LIBO 2.11.9.5 — Android UI refresh (prerelease)

**Android versionName:** `2.11.9.5` · **versionCode:** `2110905` · **package:** `app.libo.messenger.standalone`.

This build uses the current standalone Android source and carries the explicitly requested `2.11.9.5` version label. It is a prerelease rollback relative to the published `2.12.0` (`versionCode 2120000`), not a source rollback to the older 2.11.4.5 codebase. The release workflow will sign the APK with the configured LIBO release keystore, verify it with `apksigner`, and attach `SIGNING.txt`, `APK-INFO.txt`, and `SHA256SUMS.txt`. It stops instead of publishing an unsigned APK if signing secrets are missing, and it rejects any signer other than the current LIBO release certificate SHA-256 `b102233e1040405097bbb0564798521be0c043abfd616d1c5548c5fadd176371`.

## Changes

- Added the purple/pink orbit loader while LIBO opens its local database and while a saved conversation draft is restored.
- Clarified that the connection indicator reports the PeerJS signaling server only; it does not claim a contact is online or imply cloud sync.
- Added a separate local-history status and clearer, labeled mobile navigation.
- Replaced the launcher, adaptive, monochrome, and web icons with a matching purple/pink chat-orb mark.
- Kept the Android package ID `app.libo.messenger.standalone`.

## Important install warning

`2.11.9.5` has a lower Android `versionCode` than the current `2.12.0` release. Android will reject it as an in-place downgrade. To install this prerelease over 2.12.0, uninstall the existing app first; uninstalling can erase the locally stored chats, profile, and attachments. Export a backup before uninstalling. This is a prerelease and does not replace the current 2.12.0 release.

## Signing and verification

The published release includes:

- `LIBO-2.11.9.5.apk` — release APK, uploaded only after signing and verification succeed.
- `SIGNING.txt` — `apksigner verify --print-certs` output.
- `APK-INFO.txt` — package ID, version code/name, SDK, and manifest details.
- `SHA256SUMS.txt` — SHA-256 digest for the APK.

Verify the downloaded APK with `sha256sum -c SHA256SUMS.txt` and `apksigner verify --verbose --print-certs LIBO-2.11.9.5.apk`. Compare the signer certificate fingerprint in `SIGNING.txt` with the expected LIBO release signer before installation.
