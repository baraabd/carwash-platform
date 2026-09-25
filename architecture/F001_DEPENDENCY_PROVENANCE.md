# F001 tool selection and unresolved installation

The baseline root already selects pnpm 10.32.1, Node 24.x and TypeScript 5.9.3.
The preceding ownership-checker candidate adds @types/node 24.0.0. These choices
are preserved. ESLint 10.11.0, @eslint/js 10.0.1, typescript-eslint 8.70.0 and
Prettier 3.9.8 are taken from the repository's separate Sprint 0.2 manifest at
`b760ae6c1ac503709df738f9443dabfbb1f4fa00`; this does not import that branch's code
or imply those versions were installed or audited here.

Turborepo 2.11.4 was confirmed through the upstream GitHub release metadata on
25 September 2026. Its publication is not compatibility/security acceptance.
`turbo.json` defines per-workspace builds and output caching, not application
readiness. The original event-contract source remains covered by the existing
root domain build; its old package manifest is not rewritten just to add a task.

The new workflow reuses the checkout/setup-node commit pins already present in
the original reference workflow. pnpm/action-setup v4.1.0 resolves through tag
object `7088e561eb65bb68695d245aa206f005ef30921d` to commit
`a7487c7e89a18df4991f7f222e4898a00d66ddda`. The upload-artifact v4.6.2 commit is
`ea165f8d65b6e75b540449e92b4886f43607fa02`.

A real registry install, dependency resolution, lockfile, audit and target build
remain required. No lockfile is fabricated in an offline diagnostic environment.
The acceptance workflow fails closed while that prerequisite is absent.
