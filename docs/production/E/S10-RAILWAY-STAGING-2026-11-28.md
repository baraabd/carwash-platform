# S10 Railway staging infrastructure — 2026-11-28

The existing staging infrastructure patch was committed through Railway CLI 5.77.0's documented `environmentPatchCommitStaged` API after authenticated readback matched the reviewed patch. The source request used `skipDeploys: false`; no secrets were read or rewritten to reconstruct the patch.

- Project: `7aa96062-f337-4d69-92c6-2af61c9348db` (`carwash-platform`).
- Environment: `2bfd91fb-ae06-4c71-a267-913fa123699b` (`staging`).
- Applied patch: `0fd96c79-c5e2-4fb4-8393-3aed0bf56c0d`.
- The patch API returned `COMMITTED`, applied at `2026-11-28T07:54:27.369Z`, with no error; its workflow returned `Complete`.
- RabbitMQ deployment: `e427ae91-b85a-4cb2-a203-1c7493fef6c4`, `SUCCESS`, with one running replica.
- RabbitMQ's reviewed image is pinned to `rabbitmq@sha256:02c5a810ea34181122bf9e38685c1a6b0363e41290b0ae5bef4fae7477eba6db`.
- Its 5,000 MB volume is mounted at `/var/lib/rabbitmq`; both service and volume are in `asia-southeast1-eqsg3a`.
- `MediaObjects` bucket `a3403e86-7a5f-4cb1-9f5e-2e208686fba5` is live in `sin`.

The fresh sanitized [provider inventory and health readback](evidence/S10-railway-staging-2026-11-28.json) includes the observation time and exact resource/deployment IDs. Postgres and Redis each have one running replica. The database-provisioning one-shot has a successful historical deployment and zero running replicas; its API display label is not evidence of a continuously running process. At this observation there is no staged or applying work.

## Acceptance scope

This proves that the reviewed broker, volume and bucket resources were created. It does not prove broker topology/ACL, PostgreSQL owner migrations, Redis TLS/ACL, protected secret files, private-object/CORS behavior, worker progress or application journeys. The inventory contains infrastructure only; the 23 API/web processes and 13 required workers have not been deployed here. The Postgres and Redis image selectors in the provider record are tags; their runtime identity and configuration still need deployment acceptance.

The next acceptance work uses source-bound published runtime and migration artifacts, protected-file provisioning, real provider configuration, owner migrations and observed integration/worker/browser/recovery results. Record actual provider delivery, merchant facts and independent release approval separately. This infrastructure observation is not S10/S11 hosted acceptance or a production GO decision.
