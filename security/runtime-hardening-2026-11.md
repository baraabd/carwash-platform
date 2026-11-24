# Runtime and source-scanner remediation — November 2026

## Observed failures

The first acceptance candidate `979d399780f8935382dab402a278ddf5685028ff`
failed F009 image security. The unfiltered scan reported a fixable
`ca-certificates` advisory and three legacy glibc iconv converter defects.
The original runtime actually contained the affected shared objects; it was
not eligible for a claim that the vulnerable code was absent.

Canonical failing evidence:

- [F009 image scan, Booking](https://github.com/baraabd/carwash-platform/actions/runs/44997840368/job/137132707277)
- [F009 source security scan](https://github.com/baraabd/carwash-platform/actions/runs/44997840368/job/137132707140)

The Debian tracker still reported the glibc issues as unfixed at inspection.
Refreshing the official image fixes the CA certificate package but does not
remove or patch these converter implementations:

| Advisory | Affected converter code | Official source |
| --- | --- | --- |
| CVE-2026-121757 | CP949 in `UHC.so` | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-121757) |
| CVE-2026-121758 | `ISO-2022-CN-EXT.so` | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-121758) |
| CVE-2026-124024 | `IBM1390.so`, `IBM1399.so` | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-124024) |
| DSA-6572-1 | CA certificates, fixed in `20250419+deb13u1` | [Debian tracker](https://security-tracker.debian.org/tracker/DSA-6572-1) |

## Physical remediation and provenance

The runtime uses the official `base-nossl-debian13:nonroot` image resolved to
`sha256:89815d620ac01d8de13cdaf04d19ed874447ca2296d4985b14b818f6e5e47854`.
Its linux/amd64 manifest is
`sha256:3ef37b0ae7c2b13bdf0ab02119080360cb424ff6c153a6f4c85b308bb1515f89`.
The native-library donor uses official `cc-debian13:nonroot` resolved to
`sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2`;
its amd64 manifest is
`sha256:de02e95a878d4662f7a0f93bffb3799e08e04cc5a53f6a9c0593a20eaf4dc80e`.
Both indexes and their downloaded manifests/configuration/layers were checked
against their SHA-256 digests through the official `gcr.io` registry.

Every runtime Dockerfile and the service generator deletes exactly the four
shared objects above. The deletion runs with the pinned Node executable at
image build time; the final process remains UID/GID 1000. No shell or package
manager is installed in the runtime. Build failure is mandatory if the expected
converter is missing, a symlink, or otherwise differs from the reviewed layout.

The libc package record, original file checksum manifest and licence are kept.
Their original SHA-256 values are checked in the final image. Consequently the
SBOM continues to identify `libc6` as `2.41-12+deb13u4`; removal does not pretend
that the complete vendor package has been patched. The CA package is separately
required to be the fixed `20250419+deb13u1` version. The existing C++ ABI package
inventory and system-OpenSSL absence checks remain mandatory.

These legacy system conversions are outside the application's UTF-8,
Arabic/English payload contract. Runtime checks exercise UTF-8 round trips,
malformed UTF-8 rejection, Arabic numbering and Gregorian date formatting with
ICU, TLS/crypto, and the Identity native Argon2 implementation.

## Conditions for the VEX assessment

`removed-legacy-converters.openvex.json` applies only after the final immutable
image passes all filesystem and Unicode/native checks. Its package identity
contains the exact libc version, Debian 13.7 distribution and amd64 architecture.
It does not apply to the original or refreshed upstream distroless images,
which still contain the vulnerable code.

Before VEX is supplied to Trivy, the unfiltered scan is retained and checked.
Only the three specific removed-converter findings may be assessed as code
absent. The proof must name the same immutable image ID as Trivy's metadata,
the reviewed base digest, all eight canonical/UsrMerge module paths, and the
original package metadata hashes. Missing, stale, partial or mismatched proof
fails. An unrelated CVE, another package/version/architecture/distribution or
any remaining HIGH/CRITICAL/UNKNOWN finding stays blocking. The prior separate
Power8-only CVE-2026-97399 assessment is unchanged.

Evidence includes `hardening-<owner>.json`, the unfiltered inventory, final scan
summary and CycloneDX SBOM for each image. A local unit test is not proof that
the final image passed: canonical F009 image jobs must execute these checks on
the final candidate before release or merge approval.

## Source-scanner read correctness

The pinned gitleaks 8.30.1 release includes `mholt/archives` 0.1.2. Its
[Brotli name matcher](https://github.com/mholt/archives/blob/v0.1.2/brotli.go)
uses a substring match for `.br`; gitleaks calls archive identification using
the filename. This misclassifies `*.browser.mjs` as Brotli and can exit zero
after reporting an incomplete read. The initial CI log showed this on two
admin browser test files. Scanning the exact same bytes through stdin, or with
an unambiguous filename, did not produce the error.

The source scan now copies the immutable Git archive into an isolated scan
directory. Every regular file is copied byte for byte, SHA-256 checked and
listed with its original and scanning path. Only misleading archive substrings
in names are encoded. Actual terminal archive suffixes, including `.tar.gz`,
remain intact, and archive/decode depth stays enabled. Source files and archive
contents are not edited. Symlinks and special files are rejected.

The scan now requires a nonempty scan count, an empty findings report, successful
process exit and no scanner warnings/read errors. A corrupt genuine archive
cannot pass as clean. Regression tests plant generated nonfunctional secrets
near the end of a browser-named source file and inside a genuine compressed
archive; both must still be detected. Complete ancestor and merge-parent
history scanning remains in place.
