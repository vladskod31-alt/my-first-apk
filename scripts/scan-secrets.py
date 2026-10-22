#!/usr/bin/env python3
"""Scan Git blobs for credentials and key material.

Usage:
  python3 scripts/scan-secrets.py [--all] [repository-root]

Without ``--all`` the scanner walks the history of the current branch (HEAD) only —
appropriate for CI, where the checkout and the branch are what this workflow owns.
With ``--all`` it walks every branch and tag in the repository (a full repository
audit, suitable for manual or scheduled runs by the maintainer).

Checks each blob for PEM private keys, Java keystores, literal password assignments,
GitHub/AWS tokens and DER/PKCS containers. Environment references such as
``-storepass env:NAME`` are not secrets and are intentionally not flagged.
Exits non-zero when anything is found.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

PATTERNS = [
    ("PEM private key", re.compile(rb"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("SSH private key", re.compile(rb"-----BEGIN OPENSSH PRIVATE KEY-----")),
    ("keystore password literal", re.compile(rb"(?i)(storepass|keypass|keystorepassword)\s*[:=]\s*(?!env\b|file:|pass:|\$\{)[A-Za-z0-9]")),
    ("password literal", re.compile(rb"(?i)(password|passwd|pwd)\s*[:=]\s*['\"](?!\$\{|\$\()[A-Za-z0-9+/=_@.-]{8,}['\"]")),
    ("GitHub token", re.compile(rb"gh[pousr]_[A-Za-z0-9]{20,}")),
    ("AWS access key", re.compile(rb"(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])")),
    ("private key material keyword", re.compile(rb"(?i)BEGIN RSA PRIVATE|BEGIN DSA PRIVATE|BEGIN EC PRIVATE")),
]
KEYSTORE_MAGICS = {
    b"\xfe\xed\xfe\xed": "Java KeyStore (JKS)",
    b"\x30\x82": "possible PKCS#12/DER container",
}


SELF_PATHS = ("scripts/scan-secrets.py",)  # the scanner contains detection patterns


def blobs(root: Path, all_refs: bool):
    ref = "--all" if all_refs else "HEAD"
    listed = subprocess.run(
        ["git", "rev-list", ref, "--objects"],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    names = {}
    shas = []
    for line in listed:
        parts = line.split(" ", 1)
        shas.append(parts[0])
        if len(parts) > 1:
            names.setdefault(parts[0], parts[1])
    described = subprocess.run(
        ["git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
        cwd=root, input="\n".join(shas), capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    for line in described:
        sha, kind, size = line.split()
        if kind == "blob" and names.get(sha, "") not in SELF_PATHS:
            yield sha, int(size)


def main() -> int:
    args = [a for a in sys.argv[1:]]
    all_refs = False
    if "--all" in args:
        all_refs = True
        args.remove("--all")
    root = Path(args[0] if args else ".").resolve()
    findings: list[str] = []
    checked = 0
    for sha, size in blobs(root, all_refs):
        data = subprocess.run(["git", "cat-file", "blob", sha], cwd=root, capture_output=True, check=True).stdout
        checked += 1
        for label, pattern in PATTERNS:
            if pattern.search(data):
                findings.append(f"{sha}: {label}")
        jks_magic = b"\xfe\xed\xfe\xed"
        der_magic = b"\x30\x82"
        if data.startswith(jks_magic):
            findings.append(f"{sha}: {KEYSTORE_MAGICS[jks_magic]}")
        elif data.startswith(der_magic) and size > 1000 and b"PKCS" in data[:4096]:
            findings.append(f"{sha}: {KEYSTORE_MAGICS[der_magic]}")
    scope = "all branches and tags" if all_refs else "the current branch"
    print(f"Scanned {checked} blobs across {scope}.")
    if findings:
        print("FINDINGS (rotate or remove these secrets):")
        for finding in sorted(set(findings)):
            print(" -", finding)
        return 1
    print("No private keys, keystores, tokens or password literals found in Git history.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
