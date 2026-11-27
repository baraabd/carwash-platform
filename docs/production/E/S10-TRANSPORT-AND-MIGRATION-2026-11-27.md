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

The migration Dockerfile now uses the already pinned Debian 13 minimal runtime
and native-library donor. The pinned Node 24.21 binary is copied from the build
stage. The job includes Prisma 7.10, owner migrations and the ABI libraries
needed by the schema engine, including OpenSSL 3. It does not ship a shell,
apt, dpkg executables, Perl or npm. Copied libraries keep their original Debian
package records, checksum records and licenses; scans must still identify them.
The donor's OpenSSL, zlib and other findings remain subject to the same gate.

Four unused legacy iconv modules are physically removed, as for the runtime
images. A migration image receives no exemption from a runtime receipt. Its
scanner first executes the final immutable migration image as UID 1000 with a
read-only filesystem, no network, no capabilities and no privilege escalation.
That execution must prove the original libc metadata, absence of every affected
module path, Unicode/Arabic/ICU operation, TLS/crypto, visible native package
inventory and successful execution of the actual matching Prisma schema engine.

Only that fresh, image-ID-bound migration proof can classify the already
reviewed architecture/converter findings. All other HIGH, CRITICAL and UNKNOWN
findings remain blocking. The retained report includes the unfiltered inventory,
proof and blocking result. Missing, foreign, partial or runtime-only proof fails.

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

## Local diagnostics

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
