# S10 transport and migration image remediation

This is implementation evidence, not staging or production acceptance. The
release image must still pass its own CI build, immutable-image security scan,
native-engine proof and PostgreSQL migration rehearsal on the final commit.

## Observed migration-image failure

The Billing migration artifact `15182538207` from
[release run 45964270389](https://github.com/baraabd/carwash-platform/actions/runs/45964270389)
records `accepted: false` for source
`f45d2b46bd4768d16b25c86330dcff55b6d80e43`. Its final Bookworm image contained
blocking OS findings, including apt/PAM, three critical Perl findings, util-linux,
glibc converter findings and zlib. The report contained no secret findings.
Runtime image evidence does not clear this separate migration artifact.

### Current immutable migration runtime

On source `32a6c08332c296762e31ec58a8454e7c85629e37`,
[release run 46029940155](https://github.com/baraabd/carwash-platform/actions/runs/46029940155)
proved native engine execution for all 19 owner migration images, then stopped
each image on the same three HIGH findings: `CVE-2026-107494`,
`CVE-2026-124709` and `CVE-2026-124851`. The ordinary runtime jobs and
Gateway/web rehearsals do not clear that separate migration gate.

The following repair, first published as
`bcdaf6c6582d97358dbd3ad4dba93be87bb7741e`, assembles the migration job's
native runtime from seven checksum-pinned Debian 12 packages and the existing
immutable Node 24.21.0 donor. The final image starts from `scratch`; it has
Prisma 7.10, the owner's committed migration inputs, native runtime libraries
and CA trust data, with no shell or package-manager executable. It runs as
UID/GID 1000:1000 with root-owned inputs.

The committed input list is
`scripts/production/E/release/migration-runtime.lock.json`. Downloads must
come from the specified official HTTPS sources and match their SHA256 before
extraction. Original package controls, MD5 records, copyright targets, licence
texts and OS identity are retained. A build receipt binds those inputs, each
retained regular-file SHA256, the CA bundle and the native dependency closure.
No package version is rewritten to suppress scanner findings.

The choice of OpenSSL 3.0 follows Debian's status for
[CVE-2026-107494](https://security-tracker.debian.org/tracker/CVE-2026-107494)
and [CVE-2026-124709](https://security-tracker.debian.org/tracker/CVE-2026-124709):
the observed affected package line was Trixie's OpenSSL 3.5, while Bookworm's
OpenSSL 3.0 is marked unaffected. Debian's
[Bookworm lifecycle](https://www.debian.org/releases/bookworm/) still covers
the selected amd64 userland. These source facts explain the candidate choice;
they do not replace scanning the actual final image.

The assembler executes both Node and the actual deployed Prisma schema engine
through the extracted native loader. Missing libraries, unresolved dependencies
or any fallback outside the assembled rootfs stop the build. The scanner then
runs the immutable final image, without network or writable rootfs and as
UID 1000, to repeat the package/file/CA/native checks and execute the pinned
schema engine. UTF-8, Arabic and ICU behavior remain explicit checks.

### Two exact-image converter assessments

On that source,
[release run 46035455709](https://github.com/baraabd/carwash-platform/actions/runs/46035455709)
built all 19 owner migration images and passed their actual native-image probes.
Each security job then stopped on `CVE-2026-121758` and `CVE-2026-124024`
for `libc6 2.36-9+deb12u14`, severity UNKNOWN. The first Wallet artifact
`15217780373` retained those findings and `accepted: false`; this failed
receipt is not rewritten as an accepted scan.

Debian's records for
[CVE-2026-121758](https://security-tracker.debian.org/tracker/CVE-2026-121758)
and [CVE-2026-124024](https://security-tracker.debian.org/tracker/CVE-2026-124024),
together with the
[upstream glibc advisories](https://www.openwall.com/lists/oss-security/2026/11/17/32),
identify ISO-2022-CN-EXT and IBM1390/IBM1399 converters respectively. The selected
Debian package is still unfixed. The build physically removes these three modules
and the previously excluded UHC module while retaining their original package
inventory.

The new migration-specific assessment is limited to these two CVE occurrences
in the exact Debian 12.15 amd64 libc6 package. It requires the current lock hash,
the actual scanned immutable image ID, a successful final-image probe, pinned
package/control/MD5/licence and native-library hashes, and proof that every
affected converter path and alias is absent. A stale or mismatched receipt,
foreign package/PURL, another CVE or reintroduced converter cannot obtain that
assessment. Adversarial tests cover these refusals and duplicate findings.

The scan uses no CVE ignore list. The retained redacted finding inventory keeps
each original severity and blocking flag; raw output that may contain secret
matches is not uploaded. Only an individually bound `not_affected / vulnerable_code_not_present`
assessment removes that occurrence from the blocking set. It does not claim
that the Debian package was patched or that the raw scan was clean. Every other
HIGH, CRITICAL or UNKNOWN finding and every secret finding remains blocking.
The ordinary Debian 13 runtime assessment is not imported into this migration
gate. The final candidate must still pass its own build, native probe, a fresh vulnerability/secret scan at all required blocking
severities and PostgreSQL migration rehearsal before acceptance.

## One internal HTTP policy

Owner adapters and Gateway JWKS verification now use a single technical policy
from `security-kit`, re-exported by `service-kit`. This fixes the prior mismatch
where Gateway accepted a Railway origin but its JWKS verifier rejected it.
It also removes implicit plaintext trust for arbitrary dotless service names.

Each deployed service explicitly configures:

```text
CW_PRIVATE_NETWORK=railway
CW_PRIVATE_HTTP_HOSTS=identity.railway.internal,billing.railway.internal
```

The list above is an example; give each service only its actual upstream hosts.
The policy requires valid Railway-provided `RAILWAY_PROJECT_ID` and
`RAILWAY_ENVIRONMENT_ID` values. Hosts are exact single-label
`<service>.railway.internal` names. Wildcards, suffix lookalikes, trailing-dot
variants, public HTTP addresses, RFC1918 literals and dotless hostnames are
refused. Origin URLs cannot contain credentials, paths, queries or fragments.
HTTPS and explicit loopback HTTP remain supported. JWKS may have its fixed
endpoint path but no credentials, query or fragment.

The existing `GATEWAY_PRIVATE_NETWORK=railway` contract remains compatible:
its closed `GATEWAY_UPSTREAMS` map supplies the exact legacy target allowlist.
New deployment configuration should use `CW_*` consistently. Service credentials,
their scope checks, current-session verification, bounded timeouts and redirect
refusal remain independent requirements. Private-network membership never grants
an authorization scope. External payment/notification/OTP providers stay on HTTPS.

Railway documents encryption of inter-service traffic with WireGuard within the
project/environment mesh:
[private networking](https://docs.railway.com/networking/private-networking) and
[implementation details](https://docs.railway.com/networking/private-networking/how-it-works).
The minimal runtime/library composition follows the
[official distroless base documentation](https://github.com/GoogleContainerTools/distroless/blob/main/base/README.md).

## Historical local diagnostics

These counts describe the earlier transport implementation checkpoint. They do
not certify the later migration assessment or final combined candidate.

- Migration security and release artifact suites: 21 passed.
- Gateway and transport/JWKS policy suites: 48 passed.
- Booking dispatch-client and Dispatch authorization suites: 21 passed.
- The ten approved design artifact hashes remain unchanged.

These runs used pnpm 10.32.1. The first local diagnostic Node process was
24.22.3. The combined migration security, release artifact, Gateway and
transport/JWKS suites were then repeated on the exact Node 24.21.0 toolchain:
69 passed. Counts describe these specific executions and are not a total
product test count. No actual container scan, staging journey or production
launch is inferred from them.
