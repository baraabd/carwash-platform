# F009 security remediation review — 2026-09-30

Status: implementation submitted for fresh GitHub verification. This document is not acceptance evidence.

## Current-source blockers reviewed

The final-source push run on commit `3d36ef2d5af542f9692708b90121050aebb22d41`
reported two independent blocking classes:

1. every runtime image was blocked by Trivy for `CVE-2026-97399` in Debian
   `libc6`;
2. full-source push CodeQL contained six findings above the existing F009 threshold.

The PR event's CodeQL run is diff-informed and therefore is not a substitute for the
full-source push analysis.

## CVE-2026-97399 applicability

Debian currently reports the installed trixie glibc package as affected and does not
publish a fixed Debian package. Upstream GLIBC-SA-2026-0024 scopes the defect to the
Power8-optimized `strncasecmp` implementation: a one-byte overread that can cause an
availability failure in the stated circumstances.

F009 images are built and tested as `linux/amd64`. The image gate now verifies the
Docker architecture before applying the repository OpenVEX statement. The statement
is limited to `CVE-2026-97399`, Debian `libc6`, and the `amd64` PURL qualifier.

The global policy is unchanged: HIGH, CRITICAL and UNKNOWN remain blocking. The gate
first performs an unfiltered scan and refuses any blocking finding other than this
reviewed CVE/package pair; it then runs the policy scan with the local VEX. No
`--ignore-unfixed`, blanket ignore file, or severity downgrade is used.

References:
- https://security-tracker.debian.org/tracker/CVE-2026-97399
- https://sourceware.org/git/?p=glibc.git;a=blob;f=advisories/GLIBC-SA-2026-0024
- https://trivy.dev/docs/dev/supply-chain/vex/file/

## CodeQL scope and source fixes

The two HTML findings are in the byte-frozen approved customer design authority and
its byte-identical runtime prototype. Those files are reference/test inputs, not the
React/runtime implementation, and project policy forbids changing them to silence a
scanner. CodeQL now excludes exactly those two paths through a dedicated F009 config.
Their bytes remain protected by the independent reference-integrity workflow and F009
static design-reference check.

The remaining source findings are remediated in source rather than excluded:

- the Redis acceptance harness now names the high-entropy value as a generated Redis
  ACL secret instead of classifying it as an application password. Redis ACL's
  `#<digest>` file syntax requires SHA-256; application user passwords remain
  Argon2id and their tests are unchanged;
- cookie parsing no longer writes attacker-controlled property names through bracket
  assignment. It accumulates validated names in a `Map`, rejects duplicate and
  prototype-sensitive names, and returns a frozen object.

The CodeQL blocking threshold remains security severity >= 7 or SARIF error. No query
suppression or threshold reduction was introduced.

## Required re-verification

Acceptance requires new push and pull-request F009 runs on the resulting source. All
required jobs and image matrix entries must complete successfully, machine-readable
evidence must match the final source SHA/tree/run attempt, and inherited workflows
must remain green. Historical results are not acceptance for the new source.
